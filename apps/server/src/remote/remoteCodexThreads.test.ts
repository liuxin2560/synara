import { describe, expect, it, vi } from "vitest";

import { listRemoteCodexThreads, parseRemoteCodexThreadList } from "./remoteCodexThreads";

describe("remote Codex thread listing", () => {
  it("normalizes app-server thread/list data for the sidebar", () => {
    expect(
      parseRemoteCodexThreadList("cluster", {
        data: [
          {
            id: "019abc",
            name: null,
            preview: "Fix the training job\nwith more detail",
            cwd: "/srv/training",
            createdAt: 100,
            updatedAt: 200,
            status: { type: "idle" },
            source: "cli",
            parentThreadId: null,
          },
        ],
        nextCursor: "cursor-2",
      }),
    ).toEqual({
      threads: [
        {
          hostAlias: "cluster",
          threadId: "019abc",
          title: "Fix the training job",
          preview: "Fix the training job\nwith more detail",
          cwd: "/srv/training",
          createdAt: 100,
          updatedAt: 200,
          status: "idle",
          source: "cli",
        },
      ],
      nextCursor: "cursor-2",
    });
  });

  it("uses the official updated-at descending pagination contract", async () => {
    const request = vi.fn(async () => ({ data: [], nextCursor: null }));

    await listRemoteCodexThreads(
      { alias: "cluster", cursor: "cursor-1", cwd: "/srv/training", limit: 25 },
      request,
    );

    expect(request).toHaveBeenCalledWith("thread/list", {
      limit: 25,
      sortKey: "updated_at",
      sortDirection: "desc",
      archived: false,
      cursor: "cursor-1",
      cwd: "/srv/training",
    });
  });

  it("defaults to a bounded first page", async () => {
    const request = vi.fn(async () => ({ data: [], nextCursor: null }));

    await listRemoteCodexThreads({ alias: "cluster" }, request);

    expect(request).toHaveBeenCalledWith(
      "thread/list",
      expect.objectContaining({ limit: 50, archived: false }),
    );
  });

  it("drops malformed records without hiding valid remote threads", () => {
    const result = parseRemoteCodexThreadList("cluster", {
      data: [null, { id: "missing-cwd" }, { id: "valid", cwd: "/srv", status: {} }],
      nextCursor: null,
    });

    expect(result.threads).toHaveLength(1);
    expect(result.threads[0]).toMatchObject({ threadId: "valid", status: "unknown" });
  });
});
