import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import net from "node:net";

import type { RemoteSynaraWorkerConnection, SshHostAlias } from "@synara/contracts";

import { isConcreteSshHostAlias } from "./sshConfig";

const WORKER_START_TIMEOUT_MS = 30_000;
const WORKER_READY_POLL_MS = 100;
const WORKER_OUTPUT_LIMIT_BYTES = 32 * 1024;
const REMOTE_PORT_MIN = 42_000;
const REMOTE_PORT_SPAN = 8_000;

type WorkerProcess = ChildProcessWithoutNullStreams;
type SpawnWorker = (alias: string, localPort: number, remotePort: number) => WorkerProcess;
type AllocateLocalPort = () => Promise<number>;
type AllocateRemotePort = () => number;
type ProbeWorker = (localUrl: string, signal: AbortSignal) => Promise<boolean>;

interface ActiveWorker {
  readonly child: WorkerProcess;
  readonly localPort: number;
  readonly remotePort: number;
  stderr: string;
  stdout: string;
  connection: RemoteSynaraWorkerConnection;
}

export interface RemoteSynaraWorkerManagerOptions {
  readonly allocateLocalPort?: AllocateLocalPort;
  readonly allocateRemotePort?: AllocateRemotePort;
  readonly probeWorker?: ProbeWorker;
  readonly spawnWorker?: SpawnWorker;
  readonly startTimeoutMs?: number;
}

function workerAlias(alias: string): SshHostAlias {
  if (!isConcreteSshHostAlias(alias)) throw new Error(`Invalid SSH Host alias: ${alias}`);
  return alias as SshHostAlias;
}

function appendBounded(current: string, chunk: Buffer | string): string {
  if (current.length >= WORKER_OUTPUT_LIMIT_BYTES) return current;
  return `${current}${chunk.toString()}`.slice(0, WORKER_OUTPUT_LIMIT_BYTES);
}

function workerErrorDetail(worker: ActiveWorker): string {
  return (worker.stderr.trim() || worker.stdout.trim()).slice(0, 2_000);
}

function classifyWorkerFailure(detail: string): RemoteSynaraWorkerConnection["state"] {
  if (
    /code=127|synara: (?:command )?not found|command not found: synara|no such file.*synara/i.test(
      detail,
    )
  ) {
    return "incompatible";
  }
  if (
    /permission denied|could not resolve hostname|connection (?:timed out|refused|closed)|no route to host|network is unreachable/i.test(
      detail,
    )
  ) {
    return "unreachable";
  }
  return "error";
}

export function remoteSynaraWorkerCommand(remotePort: number): string {
  if (!Number.isInteger(remotePort) || remotePort < 1 || remotePort > 65_535) {
    throw new Error("Remote Synara worker port is invalid.");
  }
  // Preserve the SSH channel's stdin on fd 3 before starting the background watcher. Shells may
  // otherwise replace stdin with /dev/null for asynchronous commands. When the local owner dies
  // (including a forced Electron backend shutdown), fd 3 reaches EOF; terminate the remote worker
  // so it cannot retain the state.sqlite lifecycle lock as an orphan.
  return `exec "\${SHELL:-/bin/sh}" -lc 'exec 3<&0; synara --mode desktop --host 127.0.0.1 --port ${remotePort} --no-browser & worker_pid=$!; (while IFS= read -r _ <&3; do :; done; kill -TERM "$worker_pid" 2>/dev/null) & watcher_pid=$!; trap "kill -TERM $worker_pid $watcher_pid 2>/dev/null" HUP INT TERM EXIT; wait "$worker_pid"; worker_status=$?; kill -TERM "$watcher_pid" 2>/dev/null; wait "$watcher_pid" 2>/dev/null; trap - EXIT; exit "$worker_status"'`;
}

export function remoteSynaraWorkerSshArgs(
  alias: string,
  localPort: number,
  remotePort: number,
): string[] {
  workerAlias(alias);
  if (!Number.isInteger(localPort) || localPort < 1 || localPort > 65_535) {
    throw new Error("Local Synara worker port is invalid.");
  }
  return [
    "-T",
    "-o",
    "BatchMode=yes",
    "-o",
    "ExitOnForwardFailure=yes",
    "-o",
    "ConnectTimeout=10",
    "-o",
    "ConnectionAttempts=1",
    "-o",
    "ServerAliveInterval=15",
    "-o",
    "ServerAliveCountMax=2",
    "-L",
    `127.0.0.1:${localPort}:127.0.0.1:${remotePort}`,
    alias,
    remoteSynaraWorkerCommand(remotePort),
  ];
}

export function spawnRemoteSynaraWorker(
  alias: string,
  localPort: number,
  remotePort: number,
): WorkerProcess {
  return spawn("ssh", remoteSynaraWorkerSshArgs(alias, localPort, remotePort), {
    stdio: ["pipe", "pipe", "pipe"],
  });
}

export function allocateLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0 }, () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close((error) => {
        if (error) reject(error);
        else if (port === null) reject(new Error("Failed to allocate a loopback port."));
        else resolve(port);
      });
    });
  });
}

async function probeWorkerHttp(localUrl: string, signal: AbortSignal): Promise<boolean> {
  try {
    await fetch(localUrl, { cache: "no-store", signal });
    return true;
  } catch {
    return false;
  }
}

function randomRemotePort(): number {
  return REMOTE_PORT_MIN + Math.floor(Math.random() * REMOTE_PORT_SPAN);
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = () => {
      clearTimeout(timeout);
      reject(signal.reason);
    };
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export class RemoteSynaraWorkerManager {
  private readonly workers = new Map<string, ActiveWorker>();
  private readonly startups = new Map<string, Promise<RemoteSynaraWorkerConnection>>();
  private readonly allocateLocalPort: AllocateLocalPort;
  private readonly allocateRemotePort: AllocateRemotePort;
  private readonly probeWorker: ProbeWorker;
  private readonly spawnWorker: SpawnWorker;
  private readonly startTimeoutMs: number;
  private readonly onProcessExit = () => {
    this.terminateAllImmediately();
  };

  constructor(options: RemoteSynaraWorkerManagerOptions = {}) {
    this.allocateLocalPort = options.allocateLocalPort ?? allocateLoopbackPort;
    this.allocateRemotePort = options.allocateRemotePort ?? randomRemotePort;
    this.probeWorker = options.probeWorker ?? probeWorkerHttp;
    this.spawnWorker = options.spawnWorker ?? spawnRemoteSynaraWorker;
    this.startTimeoutMs = options.startTimeoutMs ?? WORKER_START_TIMEOUT_MS;
    // Effect finalizers cover graceful server shutdown, but Electron may have to terminate the
    // backend process after its shutdown deadline. Node's synchronous exit hook is the final
    // ownership boundary: signal every SSH child before the OS can reparent it as an orphan.
    process.once("exit", this.onProcessExit);
  }

  list(): RemoteSynaraWorkerConnection[] {
    return Array.from(this.workers.values(), (worker) => ({ ...worker.connection }));
  }

  connect(alias: string): Promise<RemoteSynaraWorkerConnection> {
    const normalizedAlias = workerAlias(alias);
    const existing = this.workers.get(normalizedAlias);
    if (existing?.connection.state === "ready") {
      return Promise.resolve({ ...existing.connection });
    }
    const startup = this.startups.get(normalizedAlias);
    if (startup) return startup;

    const nextStartup = this.start(normalizedAlias);
    this.startups.set(normalizedAlias, nextStartup);
    const clearStartup = () => {
      if (this.startups.get(normalizedAlias) === nextStartup) this.startups.delete(normalizedAlias);
    };
    void nextStartup.then(clearStartup, clearStartup);
    return nextStartup;
  }

  async disconnect(alias: string): Promise<RemoteSynaraWorkerConnection> {
    const normalizedAlias = workerAlias(alias);
    const worker = this.workers.get(normalizedAlias);
    if (worker) {
      this.workers.delete(normalizedAlias);
      if (worker.child.exitCode === null && worker.child.signalCode === null) {
        worker.child.kill("SIGTERM");
      }
    }
    return { alias: normalizedAlias, state: "disconnected" };
  }

  async stopAll(): Promise<void> {
    this.terminateAllImmediately();
    process.removeListener("exit", this.onProcessExit);
  }

  private terminateAllImmediately(): void {
    for (const worker of this.workers.values()) {
      if (worker.child.exitCode === null && worker.child.signalCode === null) {
        worker.child.kill("SIGTERM");
      }
    }
    this.workers.clear();
  }

  private async start(alias: SshHostAlias): Promise<RemoteSynaraWorkerConnection> {
    const localPort = await this.allocateLocalPort();
    const remotePort = this.allocateRemotePort();
    const child = this.spawnWorker(alias, localPort, remotePort);
    const localUrl = `http://127.0.0.1:${localPort}`;
    const worker: ActiveWorker = {
      child,
      localPort,
      remotePort,
      stdout: "",
      stderr: "",
      connection: { alias, state: "connecting" },
    };
    this.workers.set(alias, worker);
    child.stdout.on("data", (chunk: Buffer | string) => {
      worker.stdout = appendBounded(worker.stdout, chunk);
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      worker.stderr = appendBounded(worker.stderr, chunk);
    });

    const exited = new Promise<never>((_, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => {
        const detail = workerErrorDetail(worker);
        reject(
          new Error(
            `Remote Synara worker exited (code=${code ?? "null"}, signal=${signal ?? "null"}).${detail ? ` ${detail}` : ""}`,
          ),
        );
      });
    });
    const abort = new AbortController();
    const timeout = setTimeout(
      () => abort.abort(new Error("Timed out waiting for the remote Synara worker.")),
      this.startTimeoutMs,
    );

    try {
      await Promise.race([this.waitUntilReady(localUrl, abort.signal), exited]);
      worker.connection = { alias, state: "ready", localUrl };
      void exited.catch((error: unknown) => {
        if (this.workers.get(alias) !== worker) return;
        const lastError = (error instanceof Error ? error.message : String(error)).slice(0, 2_000);
        worker.connection = {
          alias,
          state: classifyWorkerFailure(lastError),
          lastError,
        };
      });
      return { ...worker.connection };
    } catch (error) {
      const lastError = (error instanceof Error ? error.message : String(error)).slice(0, 2_000);
      worker.connection = {
        alias,
        state: classifyWorkerFailure(lastError),
        lastError,
      };
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
      return { ...worker.connection };
    } finally {
      clearTimeout(timeout);
      abort.abort();
    }
  }

  private async waitUntilReady(localUrl: string, signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      if (await this.probeWorker(localUrl, signal)) return;
      await delay(WORKER_READY_POLL_MS, signal);
    }
    throw signal.reason;
  }
}
