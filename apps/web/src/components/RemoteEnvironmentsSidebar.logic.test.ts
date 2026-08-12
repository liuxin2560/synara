import type { RemoteCodexThreadSummary } from "@synara/contracts";
import { describe, expect, it } from "vitest";

import {
  groupRemoteCodexThreadsByCwd,
  remoteWorkerStatusPresentation,
} from "./RemoteEnvironmentsSidebar.logic";

function thread(input: {
  id: string;
  cwd: string;
  updatedAt: number;
  title?: string;
}): RemoteCodexThreadSummary {
  return {
    hostAlias: "cluster",
    threadId: input.id,
    title: input.title ?? input.id,
    preview: "",
    cwd: input.cwd,
    createdAt: input.updatedAt - 10,
    updatedAt: input.updatedAt,
    status: "idle",
    source: "cli",
  };
}

describe("remote environment sidebar grouping", () => {
  it("groups by exact remote cwd and orders folders and threads by recency", () => {
    const groups = groupRemoteCodexThreadsByCwd([
      thread({ id: "older-a", cwd: "/srv/a", updatedAt: 20 }),
      thread({ id: "newer-b", cwd: "/srv/b", updatedAt: 40 }),
      thread({ id: "newer-a", cwd: "/srv/a", updatedAt: 30 }),
    ]);

    expect(groups.map((group) => group.cwd)).toEqual(["/srv/b", "/srv/a"]);
    expect(groups[1]?.threads.map((entry) => entry.threadId)).toEqual(["newer-a", "older-a"]);
  });

  it("maps worker state to a stable accessible label", () => {
    expect(remoteWorkerStatusPresentation("ready").label).toBe("Connected");
    expect(remoteWorkerStatusPresentation("incompatible").label).toBe(
      "Synara is not installed",
    );
    expect(remoteWorkerStatusPresentation(undefined).label).toBe("Not connected");
  });
});
