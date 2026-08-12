import { afterEach, describe, expect, it, vi } from "vitest";

import { serializeRemoteThreadFrameName } from "./remoteBackendTarget";
import { resolveWsHttpUrl } from "./wsHttpUrl";

describe("WebSocket HTTP URL routing", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("routes HTTP resources inside a remote thread frame to its SSH-tunnelled backend", () => {
    vi.stubGlobal("window", {
      desktopBridge: { getWsUrl: () => "ws://127.0.0.1:3773/?token=local-secret" },
      location: { href: "synara://app/index.html#/", origin: "app://synara" },
      name: serializeRemoteThreadFrameName({
        version: 1,
        alias: "cluster2",
        httpUrl: "http://127.0.0.1:43123",
        pendingThread: {
          importId: "selection-id",
          synaraThreadId: "synara-thread-id",
          externalId: "codex-thread-id",
          title: "Remote task",
          cwd: "/srv/project",
          mode: "resume-original",
        },
      }),
    });
    Object.defineProperty(window, "parent", { configurable: true, value: {} });

    expect(resolveWsHttpUrl("/api/local-image?path=%2Fsrv%2Fimage.png")).toBe(
      "http://127.0.0.1:43123/api/local-image?path=%2Fsrv%2Fimage.png",
    );
  });
});
