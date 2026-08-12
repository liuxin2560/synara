import type {
  RemoteCodexThreadSummary,
  RemoteSynaraWorkerConnection,
  SshHostConfigSummary,
} from "@synara/contracts";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { FolderOpenIcon, GlobeIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";
import {
  serverConnectSynaraWorkerMutationOptions,
  serverRemoteCodexThreadsQueryOptions,
  serverSshHostsQueryOptions,
  serverSynaraWorkersQueryOptions,
} from "~/lib/serverReactQuery";
import { DisclosureChevron } from "./ui/DisclosureChevron";
import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "./ui/sidebar";
import {
  groupRemoteCodexThreadsByCwd,
  remoteWorkerStatusPresentation,
} from "./RemoteEnvironmentsSidebar.logic";

const MAX_VISIBLE_THREADS_PER_FOLDER = 5;

function RemoteThreadRow(props: {
  thread: RemoteCodexThreadSummary;
  workerReady: boolean;
  onOpenThread?: (thread: RemoteCodexThreadSummary) => void;
}) {
  const canOpen = props.workerReady && props.onOpenThread !== undefined;

  return (
    <SidebarMenuButton
      size="sm"
      disabled={!canOpen}
      title={
        canOpen
          ? props.thread.preview || props.thread.title
          : props.workerReady
            ? "Remote workspace switching is not connected yet"
            : "Connect the remote Synara worker before opening this thread"
      }
      className="h-7 pl-9 text-[length:var(--app-font-size-ui,12px)] disabled:cursor-default disabled:opacity-65"
      onClick={() => props.onOpenThread?.(props.thread)}
    >
      <span className="min-w-0 flex-1 truncate">{props.thread.title}</span>
      {props.thread.status === "active" ? (
        <span className="size-1.5 shrink-0 rounded-full bg-emerald-500" aria-label="Active" />
      ) : null}
    </SidebarMenuButton>
  );
}

function RemoteHostSection(props: {
  host: SshHostConfigSummary;
  expanded: boolean;
  worker: RemoteSynaraWorkerConnection | undefined;
  threads: readonly RemoteCodexThreadSummary[];
  threadsLoading: boolean;
  threadsError: string | null;
  onToggle: () => void;
  onConnect: () => void;
  onOpenThread?: (thread: RemoteCodexThreadSummary) => void;
}) {
  const [expandedFolders, setExpandedFolders] = useState<ReadonlySet<string>>(new Set());
  const folders = useMemo(() => groupRemoteCodexThreadsByCwd(props.threads), [props.threads]);
  const presentation = remoteWorkerStatusPresentation(props.worker?.state);
  const workerReady = props.worker?.state === "ready";
  const connectDisabled = props.worker?.state === "ready" || props.worker?.state === "connecting";
  const connectionTitle = props.worker?.lastError
    ? `${presentation.label}: ${props.worker.lastError}`
    : `${presentation.label}. Click to connect the full remote backend.`;

  return (
    <SidebarMenuItem>
      <div className="group/remote-host">
        <div className="flex items-center gap-0.5">
          <SidebarMenuButton
            size="sm"
            aria-expanded={props.expanded}
            className="h-8 min-w-0 flex-1 cursor-pointer"
            onClick={props.onToggle}
          >
            <GlobeIcon className="size-3.5 shrink-0 text-muted-foreground/75" />
            <span className="min-w-0 flex-1 truncate">{props.host.alias}</span>
            <DisclosureChevron open={props.expanded} />
          </SidebarMenuButton>
          <button
            type="button"
            disabled={connectDisabled}
            className="flex h-7 max-w-28 shrink-0 items-center gap-1.5 rounded px-1.5 text-[10px] text-muted-foreground hover:bg-sidebar-accent hover:text-foreground disabled:cursor-default disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
            title={connectionTitle}
            onClick={props.onConnect}
          >
            <span className={cn("size-1.5 rounded-full", presentation.dotClassName)} />
            <span className="truncate">{presentation.label}</span>
          </button>
        </div>

        {props.expanded ? (
          <div className="pb-1">
            {props.threadsLoading ? (
              <div className="px-8 py-2 text-[11px] text-muted-foreground/60">Loading sessions…</div>
            ) : props.threadsError ? (
              <div className="px-8 py-2 text-[11px] text-destructive/80">
                {props.threadsError}
              </div>
            ) : folders.length === 0 ? (
              <div className="px-8 py-2 text-[11px] text-muted-foreground/60">
                No Codex sessions found
              </div>
            ) : (
              folders.map((folder) => {
                const folderExpanded = expandedFolders.has(folder.cwd);
                return (
                  <div key={folder.cwd}>
                    <SidebarMenuButton
                      size="sm"
                      aria-expanded={folderExpanded}
                      className="h-7 cursor-pointer pl-6 text-[11px]"
                      onClick={() =>
                        setExpandedFolders((current) => {
                          const next = new Set(current);
                          if (next.has(folder.cwd)) next.delete(folder.cwd);
                          else next.add(folder.cwd);
                          return next;
                        })
                      }
                    >
                      <FolderOpenIcon className="size-3 shrink-0 text-muted-foreground/65" />
                      <span className="min-w-0 flex-1 truncate" title={folder.cwd}>
                        {folder.cwd}
                      </span>
                      <span className="text-[10px] tabular-nums text-muted-foreground/55">
                        {folder.threads.length}
                      </span>
                      <DisclosureChevron open={folderExpanded} />
                    </SidebarMenuButton>
                    {folderExpanded
                      ? folder.threads
                          .slice(0, MAX_VISIBLE_THREADS_PER_FOLDER)
                          .map((thread) => (
                            <RemoteThreadRow
                              key={thread.threadId}
                              thread={thread}
                              workerReady={workerReady}
                              onOpenThread={props.onOpenThread}
                            />
                          ))
                      : null}
                  </div>
                );
              })
            )}
          </div>
        ) : null}
      </div>
    </SidebarMenuItem>
  );
}

export function RemoteEnvironmentsSidebar(props: {
  enabled?: boolean;
  onOpenThread?: (thread: RemoteCodexThreadSummary) => void;
}) {
  const enabled = props.enabled ?? true;
  const queryClient = useQueryClient();
  const [expandedHosts, setExpandedHosts] = useState<ReadonlySet<string>>(new Set());
  const hostsQuery = useQuery(serverSshHostsQueryOptions({ enabled }));
  const workersQuery = useQuery(serverSynaraWorkersQueryOptions({ enabled }));
  const connectWorker = useMutation(serverConnectSynaraWorkerMutationOptions({ queryClient }));
  const hosts = hostsQuery.data?.hosts ?? [];
  const threadQueries = useQueries({
    queries: hosts.map((host) =>
      serverRemoteCodexThreadsQueryOptions({
        alias: host.alias,
        limit: 50,
        enabled: enabled && expandedHosts.has(host.alias),
      }),
    ),
  });
  const workersByAlias = useMemo(
    () => new Map((workersQuery.data?.workers ?? []).map((worker) => [worker.alias, worker])),
    [workersQuery.data?.workers],
  );

  if (!enabled || (hosts.length === 0 && !hostsQuery.isLoading && !hostsQuery.isError)) return null;

  return (
    <SidebarGroup className="px-1.5 py-1.5">
      <div className="px-2 pb-1 text-[10px] font-medium tracking-wide text-muted-foreground/55 uppercase">
        SSH servers
      </div>
      <SidebarMenu className="gap-0.5">
        {hostsQuery.isLoading ? (
          <div className="px-2 py-2 text-[11px] text-muted-foreground/60">Loading SSH hosts…</div>
        ) : hostsQuery.isError ? (
          <div className="px-2 py-2 text-[11px] text-destructive/80">
            Failed to read SSH configuration
          </div>
        ) : (
          hosts.map((host, index) => {
            const threadQuery = threadQueries[index];
            return (
              <RemoteHostSection
                key={host.alias}
                host={host}
                expanded={expandedHosts.has(host.alias)}
                worker={workersByAlias.get(host.alias)}
                threads={threadQuery?.data?.threads ?? []}
                threadsLoading={threadQuery?.isLoading ?? false}
                threadsError={threadQuery?.error instanceof Error ? threadQuery.error.message : null}
                onToggle={() =>
                  setExpandedHosts((current) => {
                    const next = new Set(current);
                    if (next.has(host.alias)) next.delete(host.alias);
                    else next.add(host.alias);
                    return next;
                  })
                }
                onConnect={() => connectWorker.mutate({ alias: host.alias })}
                onOpenThread={props.onOpenThread}
              />
            );
          })
        )}
      </SidebarMenu>
    </SidebarGroup>
  );
}
