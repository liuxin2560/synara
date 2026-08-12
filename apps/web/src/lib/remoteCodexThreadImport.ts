// FILE: remoteCodexThreadImport.ts
// Purpose: Materializes one remote Codex-native thread inside the active remote Synara backend.
// Layer: Web orchestration helper
// Exports: importPendingRemoteCodexThread

import { type NativeApi, ThreadId } from "@synara/contracts";
import { getDefaultModel } from "@synara/shared/model";
import { workspaceRootsEqual } from "@synara/shared/threadWorkspace";

import { createOrRecoverProjectFromPath } from "./projectCreation";
import type { PendingRemoteCodexThread } from "./remoteBackendTarget";
import { newCommandId } from "./utils";

export async function importPendingRemoteCodexThread(input: {
  readonly api: NativeApi;
  readonly pending: PendingRemoteCodexThread;
}): Promise<ThreadId> {
  const { api, pending } = input;
  const threadId = ThreadId.makeUnsafe(pending.synaraThreadId);
  let snapshot = await api.orchestration.getShellSnapshot();
  const existingThread = snapshot.threads.find((thread) => thread.id === threadId);

  // A resolved session proves an earlier bootstrap reached import/startSession before
  // the renderer reloaded. Treat that recovery path as success instead of importing twice.
  if (existingThread?.session && existingThread.session.status !== "stopped") {
    return threadId;
  }

  let projectId = snapshot.projects.find((candidate) =>
    workspaceRootsEqual(candidate.workspaceRoot, pending.cwd),
  )?.id;
  if (!projectId) {
    const created = await createOrRecoverProjectFromPath({
      api,
      workspaceRoot: pending.cwd,
      createIfMissing: false,
      spaceId: null,
      loadSnapshot: () => api.orchestration.getShellSnapshot(),
    });
    snapshot = created.snapshot ?? (await api.orchestration.getShellSnapshot());
    projectId =
      created.project?.id ??
      snapshot.projects.find((candidate) => candidate.id === created.projectId)?.id ??
      created.projectId;
  }

  if (!existingThread) {
    const model = getDefaultModel("codex");
    if (!model) throw new Error("No default Codex model is configured.");
    await api.orchestration.dispatchCommand({
      type: "thread.create",
      commandId: newCommandId(),
      threadId,
      projectId,
      title: pending.title,
      modelSelection: { provider: "codex", model },
      runtimeMode: "full-access",
      interactionMode: "default",
      envMode: "local",
      branch: null,
      worktreePath: null,
      workingDirectory: pending.cwd,
      createdAt: new Date().toISOString(),
    });
  }

  await api.orchestration.importThread({
    threadId,
    externalId: pending.externalId,
    mode: pending.mode,
  });
  return threadId;
}
