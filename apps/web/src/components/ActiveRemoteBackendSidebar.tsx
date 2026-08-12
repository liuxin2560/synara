import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { GlobeIcon } from "~/lib/icons";
import { importPendingRemoteCodexThread } from "~/lib/remoteCodexThreadImport";
import {
  type ActiveRemoteBackendTarget,
  clearActiveRemoteBackendTarget,
  reloadAppAtRoot,
  replacePendingRemoteThread,
  writeActiveRemoteBackendTarget,
} from "~/lib/remoteBackendTarget";
import { ensureNativeApi } from "~/nativeApi";
import { SidebarGroup, SidebarMenu, SidebarMenuItem } from "./ui/sidebar";

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
    : "The remote Codex thread could not be opened.";
}

export function ActiveRemoteBackendSidebar(props: {
  initialTarget: ActiveRemoteBackendTarget;
}) {
  const navigate = useNavigate();
  const [target, setTarget] = useState(props.initialTarget);
  const [retry, setRetry] = useState(0);
  const [opening, setOpening] = useState(target.pendingThread !== undefined);
  const [openError, setOpenError] = useState<string | null>(null);
  const pending = target.pendingThread;

  useEffect(() => {
    if (!pending) return;
    let cancelled = false;
    setOpening(true);
    setOpenError(null);
    void importRemoteThreadOnce(target)
      .then((threadId) => {
        if (cancelled) return;
        const connectedTarget = replacePendingRemoteThread(target, undefined);
        writeActiveRemoteBackendTarget(connectedTarget);
        setTarget(connectedTarget);
        setOpening(false);
        void navigate({ to: "/$threadId", params: { threadId } });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setOpening(false);
        setOpenError(errorMessage(error));
      });
    return () => {
      cancelled = true;
    };
  }, [navigate, pending, retry, target]);

  const retryWithMode = (mode: "copy" | "resume-original") => {
    if (!pending) return;
    const nextTarget = replacePendingRemoteThread(target, { ...pending, mode });
    writeActiveRemoteBackendTarget(nextTarget);
    setTarget(nextTarget);
    setRetry((value) => value + 1);
  };

  return (
    <SidebarGroup className="px-1.5 py-1.5">
      <div className="px-2 pb-1 text-[10px] font-medium tracking-wide text-muted-foreground/55 uppercase">
        Remote workspace
      </div>
      <SidebarMenu>
        <SidebarMenuItem>
          <div className="rounded-md bg-sidebar-accent/55 px-2 py-2">
            <div className="flex items-center gap-2 text-xs">
              <GlobeIcon className="size-3.5 shrink-0 text-emerald-500" />
              <span className="min-w-0 flex-1 truncate font-medium">{target.alias}</span>
              <span className="size-1.5 shrink-0 rounded-full bg-emerald-500" />
            </div>
            {pending ? (
              <div className="mt-1.5 truncate pl-5.5 text-[11px] text-muted-foreground">
                {opening ? "Opening" : "Could not open"}: {pending.title}
              </div>
            ) : (
              <div className="mt-1.5 pl-5.5 text-[11px] text-muted-foreground">
                Git, terminal, files, and agents run on this server.
              </div>
            )}
            {openError ? (
              <div className="mt-2 rounded bg-destructive/8 px-2 py-1.5 text-[10px] text-destructive">
                {openError}
              </div>
            ) : null}
            <div className="mt-2 flex flex-wrap items-center justify-end gap-1.5">
              {openError && pending ? (
                <>
                  <button
                    type="button"
                    className="rounded px-2 py-1 text-[10px] hover:bg-sidebar-accent"
                    onClick={() => retryWithMode("resume-original")}
                  >
                    Retry original
                  </button>
                  {pending.mode === "resume-original" ? (
                    <button
                      type="button"
                      className="rounded px-2 py-1 text-[10px] hover:bg-sidebar-accent"
                      onClick={() => retryWithMode("copy")}
                    >
                      Open as copy
                    </button>
                  ) : null}
                </>
              ) : null}
              <button
                type="button"
                className="rounded px-2 py-1 text-[10px] text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
                onClick={() => {
                  clearActiveRemoteBackendTarget();
                  reloadAppAtRoot();
                }}
              >
                Back to this Mac
              </button>
            </div>
          </div>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarGroup>
  );
}
