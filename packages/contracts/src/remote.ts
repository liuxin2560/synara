import { Schema } from "effect";

import { TrimmedNonEmptyString } from "./baseSchemas";
import { ExecutionEnvironmentDescriptor } from "./environment";

/** A concrete OpenSSH Host alias. Pattern-only entries are never exposed as connectable hosts. */
export const SshHostAlias = TrimmedNonEmptyString.check(
  Schema.isMaxLength(255),
  Schema.isPattern(/^(?!-)(?!.*[\s*?!\[\]]).+$/),
);
export type SshHostAlias = typeof SshHostAlias.Type;

export const SshHostConfigSummary = Schema.Struct({
  alias: SshHostAlias,
  hostname: TrimmedNonEmptyString.check(Schema.isMaxLength(255)),
  user: TrimmedNonEmptyString.check(Schema.isMaxLength(255)),
  port: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65_535 })),
  proxyJump: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(2_048))),
});
export type SshHostConfigSummary = typeof SshHostConfigSummary.Type;

export const RemoteConnectionState = Schema.Literals([
  "disconnected",
  "connecting",
  "ready",
  "unreachable",
  "auth-required",
  "host-key-error",
  "incompatible",
  "error",
]);
export type RemoteConnectionState = typeof RemoteConnectionState.Type;

export const RemoteEnvironmentConnection = Schema.Struct({
  transport: Schema.Literal("ssh"),
  host: SshHostConfigSummary,
  state: RemoteConnectionState,
  environment: Schema.optional(ExecutionEnvironmentDescriptor),
  lastError: Schema.optional(Schema.String.check(Schema.isMaxLength(2_000))),
});
export type RemoteEnvironmentConnection = typeof RemoteEnvironmentConnection.Type;

export const RemoteSshHostDiscoveryError = Schema.Struct({
  alias: SshHostAlias,
  message: TrimmedNonEmptyString.check(Schema.isMaxLength(2_000)),
});
export type RemoteSshHostDiscoveryError = typeof RemoteSshHostDiscoveryError.Type;

export const RemoteListSshHostsResult = Schema.Struct({
  hosts: Schema.Array(SshHostConfigSummary),
  errors: Schema.Array(RemoteSshHostDiscoveryError),
});
export type RemoteListSshHostsResult = typeof RemoteListSshHostsResult.Type;

export const RemoteProbeSshHostInput = Schema.Struct({
  alias: SshHostAlias,
});
export type RemoteProbeSshHostInput = typeof RemoteProbeSshHostInput.Type;

export const RemoteProbeSshHostResult = Schema.Struct({
  alias: SshHostAlias,
  state: RemoteConnectionState,
  lastError: Schema.optional(Schema.String.check(Schema.isMaxLength(2_000))),
});
export type RemoteProbeSshHostResult = typeof RemoteProbeSshHostResult.Type;

export const RemoteCodexThreadStatus = Schema.Literals([
  "notLoaded",
  "idle",
  "systemError",
  "active",
  "unknown",
]);
export type RemoteCodexThreadStatus = typeof RemoteCodexThreadStatus.Type;

export const RemoteCodexThreadSummary = Schema.Struct({
  hostAlias: SshHostAlias,
  threadId: TrimmedNonEmptyString.check(Schema.isMaxLength(255)),
  title: TrimmedNonEmptyString.check(Schema.isMaxLength(240)),
  preview: Schema.String.check(Schema.isMaxLength(2_000)),
  cwd: TrimmedNonEmptyString.check(Schema.isMaxLength(4_096)),
  createdAt: Schema.Number.check(Schema.isGreaterThanOrEqualTo(0)),
  updatedAt: Schema.Number.check(Schema.isGreaterThanOrEqualTo(0)),
  status: RemoteCodexThreadStatus,
  source: TrimmedNonEmptyString.check(Schema.isMaxLength(255)),
  parentThreadId: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(255))),
});
export type RemoteCodexThreadSummary = typeof RemoteCodexThreadSummary.Type;

export const RemoteListCodexThreadsInput = Schema.Struct({
  alias: SshHostAlias,
  cursor: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(4_096))),
  limit: Schema.optional(
    Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 })),
  ),
  cwd: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(4_096))),
});
export type RemoteListCodexThreadsInput = typeof RemoteListCodexThreadsInput.Type;

export const RemoteListCodexThreadsResult = Schema.Struct({
  threads: Schema.Array(RemoteCodexThreadSummary).check(Schema.isMaxLength(100)),
  nextCursor: Schema.NullOr(TrimmedNonEmptyString.check(Schema.isMaxLength(4_096))),
});
export type RemoteListCodexThreadsResult = typeof RemoteListCodexThreadsResult.Type;

export const RemoteSynaraWorkerState = Schema.Literals([
  "disconnected",
  "connecting",
  "ready",
  "unreachable",
  "incompatible",
  "error",
]);
export type RemoteSynaraWorkerState = typeof RemoteSynaraWorkerState.Type;

export const RemoteSynaraWorkerConnection = Schema.Struct({
  alias: SshHostAlias,
  state: RemoteSynaraWorkerState,
  localUrl: Schema.optional(
    TrimmedNonEmptyString.check(
      Schema.isMaxLength(2_048),
      Schema.isPattern(/^http:\/\/127\.0\.0\.1:\d+$/),
    ),
  ),
  environment: Schema.optional(ExecutionEnvironmentDescriptor),
  lastError: Schema.optional(Schema.String.check(Schema.isMaxLength(2_000))),
});
export type RemoteSynaraWorkerConnection = typeof RemoteSynaraWorkerConnection.Type;

export const RemoteSynaraWorkerInput = Schema.Struct({
  alias: SshHostAlias,
});
export type RemoteSynaraWorkerInput = typeof RemoteSynaraWorkerInput.Type;

export const RemoteListSynaraWorkersResult = Schema.Struct({
  workers: Schema.Array(RemoteSynaraWorkerConnection),
});
export type RemoteListSynaraWorkersResult = typeof RemoteListSynaraWorkersResult.Type;
