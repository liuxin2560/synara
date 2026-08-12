import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { describe, expect, it, vi } from "vitest";

import { CodexJsonlFramer } from "../codexAppServerTransport";
import {
  remoteCodexSshArgs,
  withRemoteCodexAppServer,
} from "./remoteCodexAppServer";

function fakeAppServer() {
  const child = new EventEmitter() as ChildProcessWithoutNullStreams;
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  Object.assign(child, {
    stdin,
    stdout,
    stderr,
    exitCode: null,
    signalCode: null,
    killed: false,
    kill: vi.fn(() => true),
  });
  const messages: Array<Record<string, unknown>> = [];
  const framer = new CodexJsonlFramer();
  stdin.on("data", (chunk: Buffer) => {
    for (const line of framer.push(chunk)) {
      const message = JSON.parse(line) as Record<string, unknown>;
      messages.push(message);
      if (message.method === "initialize") {
        stdout.write(`${JSON.stringify({ id: message.id, result: { userAgent: "codex" } })}\n`);
      } else if (message.method === "thread/list") {
        stdout.write(`${JSON.stringify({ id: message.id, result: { data: [], nextCursor: null } })}\n`);
      }
    }
  });
  return { child, messages };
}

describe("remote Codex app-server transport", () => {
  it("builds a non-interactive SSH command that starts Codex in a login shell", () => {
    expect(remoteCodexSshArgs("cluster")).toEqual([
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
      "cluster",
      `exec "\${SHELL:-/bin/sh}" -lc 'exec codex app-server --stdio'`,
    ]);
  });

  it("initializes, serves a request, and closes the SSH process", async () => {
    const server = fakeAppServer();

    const result = await withRemoteCodexAppServer(
      "cluster",
      (client) => client.request<{ data: unknown[] }>("thread/list", { limit: 50 }),
      () => server.child,
    );

    expect(result).toEqual({ data: [], nextCursor: null });
    expect(server.messages.map((message) => message.method)).toEqual([
      "initialize",
      "initialized",
      "thread/list",
    ]);
    expect(server.child.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("rejects option-like aliases before opening SSH", async () => {
    const spawnProcess = vi.fn(() => fakeAppServer().child);

    await expect(
      withRemoteCodexAppServer("-oProxyCommand=bad", async () => undefined, spawnProcess),
    ).rejects.toThrow("Invalid SSH Host alias");
    expect(spawnProcess).not.toHaveBeenCalled();
  });
});
