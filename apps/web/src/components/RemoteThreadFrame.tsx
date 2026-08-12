// FILE: RemoteThreadFrame.tsx
// Purpose: Keeps the local app shell mounted while rendering one remote session in the detail pane.
// Layer: Route UI
// Depends on: session-scoped remote targets, the isolated frame transport, and Codex import flow.

import type { ActiveRemoteBackendTarget, RemoteCodexOpenMode } from "~/lib/remoteBackendTarget";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { importPendingRemoteCodexThread } from "~/lib/remoteCodexThreadImport";
import {
  buildRemoteThreadFrameUrl,
  readRemoteThreadFrameSelectionId,
  readRemoteThreadSelection,
  replacePendingRemoteThread,
  serializeRemoteThreadFrameName,
  writeRemoteThreadSelection,
} from "~/lib/remoteBackendTarget";
import { ensureNativeApi } from "~/nativeApi";
import { RouteInsetSurface } from "./RouteInsetSurface";

const importPromiseById = new Map<string, Promise<string>>();

function importRemoteThreadOnce(target: ActiveRemoteBackendTarget): Promise<string> {
  const pending = target.pendingThread;
  if (!pending) return Promise.reject(new Error("No remote thread is pending."));
  const existing = importPromiseById.get(pending.importId);
  if (existing) return existing;
  const promise = importPendingRemoteCodexThread({ api: ensureNativeApi(), pending }).then(String);
  importPromiseById.set(pending.importId, promise);
  const release = () => {
    if (importPromiseById.get(pending.importId) === promise) {
      importPromiseById.delete(pending.importId);
    }
  };
  void promise.then(release, release);
  return promise;
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : "The remote Codex session could not be opened.";
}

export function RemoteThreadFrameBootstrap() {
  const navigate = useNavigate();
  const selectionId = readRemoteThreadFrameSelectionId();
  const initialTarget = selectionId ? readRemoteThreadSelection(selectionId) : null;
  const [target, setTarget] = useState<ActiveRemoteBackendTarget | null>(initialTarget);
  const [attempt, setAttempt] = useState(0);
  const [openError, setOpenError] = useState<string | null>(null);
  const pending = target?.pendingThread;

  useEffect(() => {
    if (!pending || !target) return;
    let cancelled = false;
    setOpenError(null);
    void importRemoteThreadOnce(target)
      .then((threadId) => {
        if (cancelled) return;
        void navigate({ to: "/$threadId", params: { threadId }, replace: true });
      })
      .catch((error: unknown) => {
        if (!cancelled) setOpenError(errorMessage(error));
      });
    return () => {
      cancelled = true;
    };
  }, [attempt, navigate, pending, target]);

  const retryWithMode = (mode: RemoteCodexOpenMode) => {
    if (!pending || !target) return;
    const nextTarget = replacePendingRemoteThread(target, { ...pending, mode });
    writeRemoteThreadSelection(nextTarget);
    setTarget(nextTarget);
    setAttempt((value) => value + 1);
  };

  return (
    <RouteInsetSurface>
      <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center p-6 text-foreground">
        <div className="w-full max-w-md rounded-xl border border-border/75 bg-card/80 p-5 text-center shadow-sm">
          <div className="text-sm font-medium">
            {openError
              ? "Could not open remote session"
              : initialTarget
                ? `Opening ${pending?.title ?? "session"}…`
                : "Remote session unavailable"}
          </div>
          <div className="mt-1.5 text-xs text-muted-foreground">
            {openError ??
              (target
                ? `Connecting through ${target.alias}`
                : "Select the session again from the main sidebar.")}
          </div>
          {openError && pending ? (
            <div className="mt-4 flex justify-center gap-2">
              <button
                type="button"
                className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted"
                onClick={() => retryWithMode("resume-original")}
              >
                Retry
              </button>
              {pending.mode === "resume-original" ? (
                <button
                  type="button"
                  className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted"
                  onClick={() => retryWithMode("copy")}
                >
                  Open as copy
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </RouteInsetSurface>
  );
}

export function RemoteThreadFrame(props: { selectionId: string }) {
  const target = readRemoteThreadSelection(props.selectionId);
  if (!target?.pendingThread) {
    return (
      <RouteInsetSurface>
        <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center p-6 text-sm text-muted-foreground">
          This remote session is no longer available. Select it again from the sidebar.
        </div>
      </RouteInsetSurface>
    );
  }

  const source = buildRemoteThreadFrameUrl(window.location.href);
  return (
    <iframe
      key={props.selectionId}
      src={source}
      name={serializeRemoteThreadFrameName(target)}
      title={`${target.alias} — ${target.pendingThread.title}`}
      className="h-svh min-h-0 min-w-0 flex-1 border-0 bg-transparent"
      allow="clipboard-read; clipboard-write"
    />
  );
}
