import { describe, expect, it } from "vitest";

import {
  buildActiveRemoteBackendTarget,
  clearActiveRemoteBackendTarget,
  parseActiveRemoteBackendTarget,
  readActiveRemoteBackendTarget,
  remoteBackendWsUrl,
  replacePendingRemoteThread,
  writeActiveRemoteBackendTarget,
} from "./remoteBackendTarget";

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => Array.from(values.keys())[index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}

describe("remote backend target", () => {
  it("accepts only token-free loopback HTTP tunnel endpoints", () => {
    const valid = parseActiveRemoteBackendTarget(
      JSON.stringify({ version: 1, alias: "cluster2", httpUrl: "http://127.0.0.1:43123" }),
    );
    expect(valid).toEqual({
      version: 1,
      alias: "cluster2",
      httpUrl: "http://127.0.0.1:43123",
    });
    expect(valid && remoteBackendWsUrl(valid)).toBe("ws://127.0.0.1:43123/");

    for (const httpUrl of [
      "https://127.0.0.1:43123",
      "http://localhost:43123",
      "http://10.0.0.5:43123",
      "http://127.0.0.1:43123/path",
      "http://127.0.0.1:43123/?token=secret",
    ]) {
      expect(
        parseActiveRemoteBackendTarget(JSON.stringify({ version: 1, alias: "bad", httpUrl })),
      ).toBeNull();
    }
  });

  it("persists a pending original-session resume only for the renderer session", () => {
    const storage = memoryStorage();
    const ids = ["import-id", "synara-thread-id"];
    const target = buildActiveRemoteBackendTarget({
      alias: "cluster2",
      httpUrl: "http://127.0.0.1:43123",
      thread: {
        externalId: "codex-thread-id",
        title: "Remote task",
        cwd: "/srv/project",
      },
      randomId: () => ids.shift()!,
    });

    writeActiveRemoteBackendTarget(target, storage);
    expect(readActiveRemoteBackendTarget(storage)).toEqual(target);
    expect(target.pendingThread?.mode).toBe("resume-original");

    const withoutPending = replacePendingRemoteThread(target, undefined);
    writeActiveRemoteBackendTarget(withoutPending, storage);
    expect(readActiveRemoteBackendTarget(storage)).toEqual(withoutPending);

    clearActiveRemoteBackendTarget(storage);
    expect(readActiveRemoteBackendTarget(storage)).toBeNull();
  });

  it("rejects malformed pending imports instead of partially trusting them", () => {
    expect(
      parseActiveRemoteBackendTarget(
        JSON.stringify({
          version: 1,
          alias: "cluster2",
          httpUrl: "http://127.0.0.1:43123",
          pendingThread: { externalId: "missing-fields" },
        }),
      ),
    ).toBeNull();
  });
});
