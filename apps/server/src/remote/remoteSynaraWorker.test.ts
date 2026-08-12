import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { describe, expect, it, vi } from "vitest";

import {
  RemoteSynaraWorkerManager,
  remoteSynaraWorkerSshArgs,
} from "./remoteSynaraWorker";

function fakeWorkerProcess() {
  const child = new EventEmitter() as ChildProcessWithoutNullStreams;
  Object.assign(child, {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    exitCode: null,
    signalCode: null,
    killed: false,
    kill: vi.fn(() => true),
  });
  return child;
}

describe("remote Synara worker", () => {
  it("binds both ends to loopback and starts the remote desktop backend", () => {
    expect(remoteSynaraWorkerSshArgs("cluster", 43123, 45123)).toEqual([
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
      "127.0.0.1:43123:127.0.0.1:45123",
      "cluster",
      `exec "\${SHELL:-/bin/sh}" -lc 'exec 3<&0; synara --mode desktop --host 127.0.0.1 --port 45123 --no-browser & worker_pid=$!; (while IFS= read -r _ <&3; do :; done; kill -TERM "$worker_pid" 2>/dev/null) & watcher_pid=$!; trap "kill -TERM $worker_pid $watcher_pid 2>/dev/null" HUP INT TERM EXIT; wait "$worker_pid"; worker_status=$?; kill -TERM "$watcher_pid" 2>/dev/null; wait "$watcher_pid" 2>/dev/null; trap - EXIT; exit "$worker_status"'`,
    ]);
  });

  it("deduplicates concurrent startup and reuses a ready worker", async () => {
    const child = fakeWorkerProcess();
    const spawnWorker = vi.fn(() => child);
    const manager = new RemoteSynaraWorkerManager({
      allocateLocalPort: async () => 43123,
      allocateRemotePort: () => 45123,
      probeWorker: async () => true,
      spawnWorker,
    });

    const [first, second] = await Promise.all([
      manager.connect("cluster"),
      manager.connect("cluster"),
    ]);

    expect(first).toEqual({
      alias: "cluster",
      state: "ready",
      localUrl: "http://127.0.0.1:43123",
    });
    expect(second).toEqual(first);
    expect(await manager.connect("cluster")).toEqual(first);
    expect(spawnWorker).toHaveBeenCalledTimes(1);
  });

  it("classifies a missing remote Synara CLI as incompatible", async () => {
    const child = fakeWorkerProcess();
    const manager = new RemoteSynaraWorkerManager({
      allocateLocalPort: async () => 43123,
      allocateRemotePort: () => 45123,
      probeWorker: async () => false,
      spawnWorker: () => {
        queueMicrotask(() => {
          child.stderr.write("bash: synara: command not found\n");
          child.emit("exit", 127, null);
        });
        return child;
      },
    });

    await expect(manager.connect("cluster")).resolves.toMatchObject({
      alias: "cluster",
      state: "incompatible",
      lastError: expect.stringContaining("code=127"),
    });
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("disconnects only the selected worker", async () => {
    const child = fakeWorkerProcess();
    const manager = new RemoteSynaraWorkerManager({
      allocateLocalPort: async () => 43123,
      allocateRemotePort: () => 45123,
      probeWorker: async () => true,
      spawnWorker: () => child,
    });
    await manager.connect("cluster");

    await expect(manager.disconnect("cluster")).resolves.toEqual({
      alias: "cluster",
      state: "disconnected",
    });
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    expect(manager.list()).toEqual([]);
  });

  it("stops every SSH child and removes its process-exit cleanup", async () => {
    const exitListenersBefore = process.listenerCount("exit");
    const child = fakeWorkerProcess();
    const manager = new RemoteSynaraWorkerManager({
      allocateLocalPort: async () => 43123,
      allocateRemotePort: () => 45123,
      probeWorker: async () => true,
      spawnWorker: () => child,
    });
    expect(process.listenerCount("exit")).toBe(exitListenersBefore + 1);
    await manager.connect("cluster");

    await manager.stopAll();

    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    expect(manager.list()).toEqual([]);
    expect(process.listenerCount("exit")).toBe(exitListenersBefore);
  });
});
