import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

import { CodexJsonlFramer, CodexJsonlWriter } from "../codexAppServerTransport";
import { isConcreteSshHostAlias } from "./sshConfig";

const REMOTE_CODEX_REQUEST_TIMEOUT_MS = 30_000;
const REMOTE_CODEX_STDERR_LIMIT_BYTES = 32 * 1024;
const REMOTE_CODEX_COMMAND = `exec "\${SHELL:-/bin/sh}" -lc 'exec codex app-server --stdio'`;

interface PendingRequest {
  readonly method: string;
  readonly timeout: ReturnType<typeof setTimeout>;
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
}

type SpawnRemoteProcess = (alias: string) => ChildProcessWithoutNullStreams;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function errorMessage(value: unknown): string | undefined {
  const record = asRecord(value);
  return typeof record?.message === "string" ? record.message : undefined;
}

export function spawnRemoteCodexAppServer(alias: string): ChildProcessWithoutNullStreams {
  return spawn("ssh", remoteCodexSshArgs(alias), { stdio: ["pipe", "pipe", "pipe"] });
}

export function remoteCodexSshArgs(alias: string): string[] {
  if (!isConcreteSshHostAlias(alias)) throw new Error(`Invalid SSH Host alias: ${alias}`);
  return [
    "-T",
    "-o",
    "BatchMode=yes",
    "-o",
    "ConnectTimeout=10",
    "-o",
    "ConnectionAttempts=1",
    "-o",
    "ServerAliveInterval=15",
    "-o",
    "ServerAliveCountMax=2",
    alias,
    REMOTE_CODEX_COMMAND,
  ];
}

export class RemoteCodexAppServerClient {
  private readonly framer = new CodexJsonlFramer();
  private readonly writer: CodexJsonlWriter;
  private readonly pending = new Map<string, PendingRequest>();
  private nextRequestId = 1;
  private stderr = "";
  private closed = false;

  private constructor(
    readonly alias: string,
    private readonly child: ChildProcessWithoutNullStreams,
  ) {
    this.writer = new CodexJsonlWriter(child.stdin);
    child.stdout.on("data", (chunk: Buffer) => this.handleStdout(chunk));
    child.stderr.on("data", (chunk: Buffer) => this.handleStderr(chunk));
    child.once("error", (error) => this.fail(error));
    child.once("exit", (code, signal) => {
      this.fail(
        new Error(
          `Remote Codex app-server exited (code=${code ?? "null"}, signal=${signal ?? "null"}).${this.stderrDetail()}`,
        ),
      );
    });
  }

  static async connect(
    alias: string,
    spawnProcess: SpawnRemoteProcess = spawnRemoteCodexAppServer,
  ): Promise<RemoteCodexAppServerClient> {
    if (!isConcreteSshHostAlias(alias)) throw new Error(`Invalid SSH Host alias: ${alias}`);
    const client = new RemoteCodexAppServerClient(alias, spawnProcess(alias));
    try {
      await client.request("initialize", {
        clientInfo: { name: "synara_desktop", title: "Synara Desktop", version: "0.7.1" },
        capabilities: { experimentalApi: true },
      });
      await client.notify("initialized");
      return client;
    } catch (error) {
      await client.close();
      throw error;
    }
  }

  async request<T>(method: string, params: unknown, timeoutMs = REMOTE_CODEX_REQUEST_TIMEOUT_MS) {
    if (this.closed) throw new Error(`Remote Codex app-server for ${this.alias} is closed.`);
    const id = this.nextRequestId++;
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(String(id));
        reject(new Error(`Timed out waiting for remote Codex ${method}.${this.stderrDetail()}`));
      }, timeoutMs);
      this.pending.set(String(id), {
        method,
        timeout,
        resolve: (value) => resolve(value as T),
        reject,
      });
      void this.writer.write({ id, method, params }).catch((error) => {
        clearTimeout(timeout);
        this.pending.delete(String(id));
        reject(error instanceof Error ? error : new Error(String(error)));
      });
    });
  }

  notify(method: string, params?: unknown): Promise<void> {
    return this.writer.write({ method, ...(params === undefined ? {} : { params }) });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const error = new Error(`Remote Codex app-server for ${this.alias} was closed.`);
    this.rejectPending(error);
    this.writer.close(error);
    this.child.stdin.end();
    if (this.child.exitCode === null && this.child.signalCode === null) this.child.kill("SIGTERM");
  }

  private handleStdout(chunk: Buffer): void {
    if (this.closed) return;
    try {
      for (const line of this.framer.push(chunk)) this.handleLine(line);
    } catch (error) {
      this.fail(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private handleLine(line: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return;
    }
    const message = asRecord(parsed);
    if (!message) return;
    if ((typeof message.id === "string" || typeof message.id === "number") && message.method) {
      void this.writer.write({
        id: message.id,
        error: { code: -32601, message: `Unsupported server request: ${String(message.method)}` },
      });
      return;
    }
    if (typeof message.id !== "string" && typeof message.id !== "number") return;
    const pending = this.pending.get(String(message.id));
    if (!pending) return;
    clearTimeout(pending.timeout);
    this.pending.delete(String(message.id));
    if (message.error !== undefined && message.error !== null) {
      pending.reject(
        new Error(`${pending.method} failed: ${errorMessage(message.error) ?? "Unknown error"}`),
      );
    } else {
      pending.resolve(message.result);
    }
  }

  private handleStderr(chunk: Buffer): void {
    if (this.stderr.length >= REMOTE_CODEX_STDERR_LIMIT_BYTES) return;
    this.stderr = `${this.stderr}${chunk.toString()}`.slice(0, REMOTE_CODEX_STDERR_LIMIT_BYTES);
  }

  private stderrDetail(): string {
    const detail = this.stderr.trim();
    return detail ? ` ${detail.slice(0, 2_000)}` : "";
  }

  private fail(error: Error): void {
    if (this.closed) return;
    this.closed = true;
    this.rejectPending(error);
    this.writer.close(error);
    if (this.child.exitCode === null && this.child.signalCode === null) this.child.kill("SIGTERM");
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

export async function withRemoteCodexAppServer<T>(
  alias: string,
  operation: (client: RemoteCodexAppServerClient) => Promise<T>,
  spawnProcess?: SpawnRemoteProcess,
): Promise<T> {
  const client = await RemoteCodexAppServerClient.connect(alias, spawnProcess);
  try {
    return await operation(client);
  } finally {
    await client.close();
  }
}
