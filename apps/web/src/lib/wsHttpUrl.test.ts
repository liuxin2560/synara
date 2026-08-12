import { afterEach, describe, expect, it, vi } from "vitest";

import { writeActiveRemoteBackendTarget } from "./remoteBackendTarget";
import { resolveWsHttpUrl } from "./wsHttpUrl";

describe("WebSocket HTTP URL routing", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("routes HTTP resources to the active SSH-tunnelled backend", () => {
    const values = new Map<string, string>();
    vi.stubGlobal("window", {
      sessionStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        removeItem: (key: string) => values.delete(key),
        setItem: (key: string, value: string) => values.set(key, value),
      },
      desktopBridge: { getWsUrl: () => "ws://127.0.0.1:3773/?token=local-secret" },
      location: { origin: "app://synara" },
    });
    writeActiveRemoteBackendTarget({
      version: 1,
      alias: "cluster2",
      httpUrl: "http://127.0.0.1:43123",
    });

    expect(resolveWsHttpUrl("/api/local-image?path=%2Fsrv%2Fimage.png")).toBe(
      "http://127.0.0.1:43123/api/local-image?path=%2Fsrv%2Fimage.png",
    );
  });
});
