import type { RemoteCodexThreadSummary, RemoteSynaraWorkerState } from "@synara/contracts";

export function selectEnabledRemoteHosts<Host extends { readonly alias: string }>(
  hosts: readonly Host[],
  connections: readonly { readonly alias: string; readonly enabled: boolean }[],
): Host[] {
  const enabledAliases = new Set(
    connections.filter((connection) => connection.enabled).map((connection) => connection.alias),
  );
  return hosts.filter((host) => enabledAliases.has(host.alias));
}

export interface RemoteThreadFolder {
  readonly cwd: string;
  readonly threads: readonly RemoteCodexThreadSummary[];
  readonly updatedAt: number;
}

export function groupRemoteCodexThreadsByCwd(
  threads: readonly RemoteCodexThreadSummary[],
): RemoteThreadFolder[] {
  const byCwd = new Map<string, RemoteCodexThreadSummary[]>();
  for (const thread of threads) {
    const existing = byCwd.get(thread.cwd);
    if (existing) existing.push(thread);
    else byCwd.set(thread.cwd, [thread]);
  }

  return Array.from(byCwd, ([cwd, cwdThreads]) => {
    const sortedThreads = cwdThreads.toSorted(
      (left, right) => right.updatedAt - left.updatedAt || left.title.localeCompare(right.title),
    );
    return {
      cwd,
      threads: sortedThreads,
      updatedAt: sortedThreads[0]?.updatedAt ?? 0,
    };
  }).toSorted((left, right) => right.updatedAt - left.updatedAt || left.cwd.localeCompare(right.cwd));
}

export function remoteWorkerStatusPresentation(state: RemoteSynaraWorkerState | undefined): {
  readonly label: string;
  readonly dotClassName: string;
} {
  switch (state) {
    case "ready":
      return { label: "Connected", dotClassName: "bg-emerald-500" };
    case "connecting":
      return { label: "Connecting", dotClassName: "bg-amber-400 animate-pulse" };
    case "incompatible":
      return { label: "Synara is not installed", dotClassName: "bg-amber-500" };
    case "unreachable":
      return { label: "Unreachable", dotClassName: "bg-destructive" };
    case "error":
      return { label: "Connection error", dotClassName: "bg-destructive" };
    case "disconnected":
    default:
      return { label: "Not connected", dotClassName: "bg-muted-foreground/35" };
  }
}
