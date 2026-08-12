import { describe, expect, it } from "vitest";

import {
  buildActiveRemoteBackendTarget,
  buildRemoteThreadFrameUrl,
  clearRemoteThreadSelection,
  isRemoteThreadFrame,
  parseActiveRemoteBackendTarget,
  parseRemoteThreadFrameName,
  readRemoteFrameBackendWsUrl,
  readRemoteThreadFrameSelectionId,
  readRemoteThreadSelection,
  remoteBackendWsUrl,
  replacePendingRemoteThread,
  serializeRemoteThreadFrameName,
  writeRemoteThreadSelection,
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

  it("persists each selected remote session independently for the renderer session", () => {
    const storage = memoryStorage();
    const ids = ["selection-id", "synara-thread-id"];
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

    expect(writeRemoteThreadSelection(target, storage)).toBe("selection-id");
    expect(readRemoteThreadSelection("selection-id", storage)).toEqual(target);
    expect(target.pendingThread?.mode).toBe("resume-original");

    const copied = replacePendingRemoteThread(target, {
      ...target.pendingThread!,
      mode: "copy",
    });
    expect(copied.pendingThread?.mode).toBe("copy");

    clearRemoteThreadSelection("selection-id", storage);
    expect(readRemoteThreadSelection("selection-id", storage)).toBeNull();
  });

  it("builds an isolated frame URL without changing the parent backend", () => {
    const target = buildActiveRemoteBackendTarget({
      alias: "cluster2",
      httpUrl: "http://127.0.0.1:43123",
      thread: { externalId: "codex-1", title: "Remote task", cwd: "/srv/project" },
      randomId: (() => {
        const ids = ["selection-id", "synara-id"];
        return () => ids.shift()!;
      })(),
    });
    const frameUrl = buildRemoteThreadFrameUrl("synara://app/index.html?local=value#/local-thread");
    const frameName = serializeRemoteThreadFrameName(target);

    expect(frameUrl).toBe("synara://app/index.html#/");
    expect(parseRemoteThreadFrameName(frameName)).toEqual({
      version: 1,
      selectionId: "selection-id",
      httpUrl: "http://127.0.0.1:43123",
    });
    expect(isRemoteThreadFrame(frameName)).toBe(true);
    expect(readRemoteThreadFrameSelectionId(frameName)).toBe("selection-id");
    expect(readRemoteFrameBackendWsUrl(frameName)).toBe("ws://127.0.0.1:43123/");
    expect(isRemoteThreadFrame("ordinary-frame")).toBe(false);
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
