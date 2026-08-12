// FILE: ConnectionsSettingsPanel.tsx
// Purpose: Let users explicitly allowlist and start SSH-backed Synara environments.
// Layer: Settings UI component
// Exports: ConnectionsSettingsPanel

import type { SshHostConfigSummary } from "@synara/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import type { AppSettingsBinding } from "~/appSettings";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "~/components/ui/dialog";
import { Select, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import { Switch } from "~/components/ui/switch";
import { GlobeIcon, PlusIcon, RefreshCwIcon, Trash2 } from "~/lib/icons";
import {
  serverConnectSynaraWorkerMutationOptions,
  serverDisconnectSynaraWorkerMutationOptions,
  serverSshHostsQueryOptions,
  serverSynaraWorkersQueryOptions,
} from "~/lib/serverReactQuery";
import { cn } from "~/lib/utils";
import { remoteWorkerStatusPresentation } from "../RemoteEnvironmentsSidebar.logic";
import {
  SettingsCard,
  SettingsEmptyState,
  SettingsListRow,
  SettingsSectionShell,
  SettingsSelectPopup,
} from "./SettingsPanelPrimitives";

function describeHost(host: SshHostConfigSummary | undefined): string {
  if (!host) return "This alias is no longer present in ~/.ssh/config.";
  const destination = `${host.user}@${host.hostname}:${host.port}`;
  return host.proxyJump ? `${destination} · via ${host.proxyJump}` : destination;
}

export function ConnectionsSettingsPanel(
  props: AppSettingsBinding & { active: boolean },
) {
  const queryClient = useQueryClient();
  const hostsQuery = useQuery(serverSshHostsQueryOptions({ enabled: props.active }));
  const workersQuery = useQuery(serverSynaraWorkersQueryOptions({ enabled: props.active }));
  const connectWorker = useMutation(serverConnectSynaraWorkerMutationOptions({ queryClient }));
  const disconnectWorker = useMutation(
    serverDisconnectSynaraWorkerMutationOptions({ queryClient }),
  );
  const [addOpen, setAddOpen] = useState(false);
  const [selectedAlias, setSelectedAlias] = useState<string | null>(null);
  const [connectAfterAdding, setConnectAfterAdding] = useState(true);

  const hosts = hostsQuery.data?.hosts ?? [];
  const hostsByAlias = useMemo(
    () => new Map(hosts.map((host) => [host.alias, host])),
    [hosts],
  );
  const workersByAlias = useMemo(
    () => new Map((workersQuery.data?.workers ?? []).map((worker) => [worker.alias, worker])),
    [workersQuery.data?.workers],
  );
  const configuredAliases = useMemo(
    () => new Set(props.settings.remoteSshConnections.map((connection) => connection.alias)),
    [props.settings.remoteSshConnections],
  );
  const availableHosts = hosts.filter((host) => !configuredAliases.has(host.alias));

  useEffect(() => {
    if (!addOpen) return;
    if (!selectedAlias || !availableHosts.some((host) => host.alias === selectedAlias)) {
      setSelectedAlias(availableHosts[0]?.alias ?? null);
    }
  }, [addOpen, availableHosts, selectedAlias]);

  if (!props.active) return null;

  const setConnectionEnabled = (alias: string, enabled: boolean) => {
    props.updateSettings({
      remoteSshConnections: props.settings.remoteSshConnections.map((connection) =>
        connection.alias === alias ? { ...connection, enabled } : connection,
      ),
    });
    if (enabled) connectWorker.mutate({ alias });
    else disconnectWorker.mutate({ alias });
  };

  const addConnection = () => {
    if (!selectedAlias) return;
    props.updateSettings({
      remoteSshConnections: [
        ...props.settings.remoteSshConnections,
        { alias: selectedAlias, enabled: connectAfterAdding },
      ],
    });
    if (connectAfterAdding) connectWorker.mutate({ alias: selectedAlias });
    setAddOpen(false);
  };

  const removeConnection = (alias: string) => {
    disconnectWorker.mutate({ alias });
    props.updateSettings({
      remoteSshConnections: props.settings.remoteSshConnections.filter(
        (connection) => connection.alias !== alias,
      ),
    });
  };

  return (
    <div className="space-y-8">
      <SettingsSectionShell
        title="SSH connections from this Mac"
        action={
          <div className="flex items-center gap-1.5">
            <Button
              size="xs"
              variant="ghost"
              aria-label="Refresh SSH hosts"
              disabled={hostsQuery.isFetching}
              onClick={() => void hostsQuery.refetch()}
            >
              <RefreshCwIcon className={cn("size-3.5", hostsQuery.isFetching && "animate-spin")} />
              Refresh
            </Button>
            <Button size="xs" onClick={() => setAddOpen(true)}>
              <PlusIcon className="size-3.5" />
              Add
            </Button>
          </div>
        }
      >
        {hostsQuery.isLoading ? (
          <SettingsEmptyState layout="status">Reading ~/.ssh/config…</SettingsEmptyState>
        ) : hostsQuery.isError ? (
          <SettingsEmptyState layout="status" tone="destructive">
            Synara could not read the local SSH configuration.
          </SettingsEmptyState>
        ) : props.settings.remoteSshConnections.length === 0 ? (
          <SettingsEmptyState>
            No SSH servers added. Add a host from your existing ~/.ssh/config to show it in the
            sidebar.
          </SettingsEmptyState>
        ) : (
          <SettingsCard>
            {props.settings.remoteSshConnections.map((connection) => {
              const host = hostsByAlias.get(connection.alias);
              const worker = workersByAlias.get(connection.alias);
              const presentation = remoteWorkerStatusPresentation(worker?.state);
              const status = connection.enabled ? presentation.label : "Disabled";
              const statusDetail = worker?.lastError ? `${status} — ${worker.lastError}` : status;
              const pending =
                (connectWorker.isPending || disconnectWorker.isPending) &&
                (connectWorker.variables?.alias === connection.alias ||
                  disconnectWorker.variables?.alias === connection.alias);
              return (
                <SettingsListRow
                  key={connection.alias}
                  title={
                    <span className="inline-flex min-w-0 items-center gap-2">
                      <GlobeIcon className="size-3.5 shrink-0 text-muted-foreground" />
                      <span className="truncate">{connection.alias}</span>
                    </span>
                  }
                  description={
                    <span className="space-y-0.5">
                      <span className="block">{describeHost(host)}</span>
                      <span className="flex items-center gap-1.5">
                        <span
                          className={cn(
                            "size-1.5 shrink-0 rounded-full",
                            connection.enabled
                              ? presentation.dotClassName
                              : "bg-muted-foreground/35",
                          )}
                        />
                        <span>{pending ? "Updating connection…" : statusDetail}</span>
                      </span>
                    </span>
                  }
                  actions={
                    <>
                      <Switch
                        checked={connection.enabled}
                        disabled={!host || pending}
                        aria-label={`${connection.enabled ? "Disable" : "Enable"} ${connection.alias}`}
                        onCheckedChange={(enabled) =>
                          setConnectionEnabled(connection.alias, enabled)
                        }
                      />
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        aria-label={`Remove ${connection.alias}`}
                        disabled={pending}
                        onClick={() => removeConnection(connection.alias)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </>
                  }
                />
              );
            })}
          </SettingsCard>
        )}
      </SettingsSectionShell>

      <p className="text-xs leading-relaxed text-muted-foreground">
        Synara uses OpenSSH for hostnames, keys, jump hosts, and authentication. It stores only
        the selected host aliases and whether each connection should start. Disabling a server
        closes its Synara worker and removes it from the sidebar.
      </p>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogPopup className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add SSH server</DialogTitle>
            <DialogDescription>
              Choose a concrete host alias discovered in ~/.ssh/config.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel className="space-y-4">
            {availableHosts.length === 0 ? (
              <SettingsEmptyState layout="status">
                Every discovered SSH host has already been added.
              </SettingsEmptyState>
            ) : (
              <>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-foreground" htmlFor="ssh-host-alias">
                    Server
                  </label>
                  <Select
                    value={selectedAlias}
                    onValueChange={(value) => value && setSelectedAlias(value)}
                  >
                    <SelectTrigger id="ssh-host-alias" className="w-full">
                      <SelectValue>{selectedAlias ?? "Choose a server"}</SelectValue>
                    </SelectTrigger>
                    <SettingsSelectPopup align="start">
                      {availableHosts.map((host) => (
                        <SelectItem key={host.alias} value={host.alias}>
                          {host.alias} · {host.user}@{host.hostname}
                        </SelectItem>
                      ))}
                    </SettingsSelectPopup>
                  </Select>
                </div>
                <label className="flex items-center justify-between gap-4 rounded-lg border border-border/70 px-3 py-2.5">
                  <span>
                    <span className="block text-sm font-medium">Connect after adding</span>
                    <span className="block text-xs text-muted-foreground">
                      Start the SSH tunnel and remote Synara worker immediately.
                    </span>
                  </span>
                  <Switch
                    checked={connectAfterAdding}
                    aria-label="Connect after adding"
                    onCheckedChange={setConnectAfterAdding}
                  />
                </label>
              </>
            )}
          </DialogPanel>
          <DialogFooter>
            <DialogClose render={<Button type="button" size="sm" variant="outline">Cancel</Button>} />
            <Button type="button" size="sm" disabled={!selectedAlias} onClick={addConnection}>
              Add server
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </div>
  );
}
