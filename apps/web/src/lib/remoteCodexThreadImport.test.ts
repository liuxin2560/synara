import type { NativeApi, OrchestrationShellSnapshot } from "@synara/contracts";
import { describe, expect, it, vi } from "vitest";

import type { PendingRemoteCodexThread } from "./remoteBackendTarget";
import { importPendingRemoteCodexThread } from "./remoteCodexThreadImport";

const pending: PendingRemoteCodexThread = {
  importId: "import-1",
  synaraThreadId: "synara-thread-1",
  externalId: "codex-thread-1",
  title: "Remote Codex task",
  cwd: "/srv/project",
  mode: "resume-original",
};

function snapshot(input?: {
  readonly sessionStatus?: "ready" | "stopped";
}): OrchestrationShellSnapshot {
  return {
    snapshotSequence: 1,
    spaces: [],
    projects: [
      {
        id: "project-1",
        kind: "project",
        title: "project",
        workspaceRoot: "/srv/project/",
        defaultModelSelection: null,
        scripts: [],
        isPinned: false,
        spaceId: null,
        createdAt: "2026-08-12T00:00:00.000Z",
        updatedAt: "2026-08-12T00:00:00.000Z",
      },
    ],
    threads: input?.sessionStatus
      ? [
          {
            id: "synara-thread-1",
            projectId: "project-1",
            title: "Remote Codex task",
            modelSelection: { provider: "codex", model: "gpt-5.5" },
            runtimeMode: "full-access",
            interactionMode: "default",
            envMode: "local",
            branch: null,
            worktreePath: null,
            workingDirectory: "/srv/project",
            associatedWorktreePath: null,
            associatedWorktreeBranch: null,
            associatedWorktreeRef: null,
            createBranchFlowCompleted: false,
            isPinned: false,
            parentThreadId: null,
            creationSource: null,
            sourceThreadId: null,
            sourceTurnId: null,
            gatewayOperationId: null,
            gatewayOperationIndex: null,
            subagentAgentId: null,
            subagentNickname: null,
            subagentRole: null,
            forkSourceThreadId: null,
            sidechatSourceThreadId: null,
            lastKnownPr: null,
            latestTurn: null,
            createdAt: "2026-08-12T00:00:00.000Z",
            updatedAt: "2026-08-12T00:00:00.000Z",
            archivedAt: null,
            settledAt: null,
            handoff: null,
            session: {
              threadId: "synara-thread-1",
              status: input.sessionStatus,
              providerName: "codex",
              runtimeMode: "full-access",
              activeTurnId: null,
              lastError: null,
              updatedAt: "2026-08-12T00:00:00.000Z",
            },
          },
        ]
      : [],
    updatedAt: "2026-08-12T00:00:00.000Z",
  } as OrchestrationShellSnapshot;
}

describe("remote Codex thread import", () => {
  it("creates a Synara thread in the matching remote folder and resumes the original", async () => {
    const dispatchCommand = vi.fn().mockResolvedValue({ sequence: 2 });
    const importThread = vi.fn().mockResolvedValue({ threadId: "synara-thread-1" });
    const api = {
      orchestration: {
        getShellSnapshot: vi.fn().mockResolvedValue(snapshot()),
        dispatchCommand,
        importThread,
      },
    } as unknown as NativeApi;

    await expect(importPendingRemoteCodexThread({ api, pending })).resolves.toBe(
      "synara-thread-1",
    );
    expect(dispatchCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "thread.create",
        threadId: "synara-thread-1",
        projectId: "project-1",
        workingDirectory: "/srv/project",
        modelSelection: expect.objectContaining({ provider: "codex" }),
      }),
    );
    expect(importThread).toHaveBeenCalledWith({
      threadId: "synara-thread-1",
      externalId: "codex-thread-1",
      mode: "resume-original",
    });
  });

  it("recovers after reload when the imported provider session already exists", async () => {
    const dispatchCommand = vi.fn();
    const importThread = vi.fn();
    const api = {
      orchestration: {
        getShellSnapshot: vi.fn().mockResolvedValue(snapshot({ sessionStatus: "ready" })),
        dispatchCommand,
        importThread,
      },
    } as unknown as NativeApi;

    await expect(importPendingRemoteCodexThread({ api, pending })).resolves.toBe(
      "synara-thread-1",
    );
    expect(dispatchCommand).not.toHaveBeenCalled();
    expect(importThread).not.toHaveBeenCalled();
  });
});
