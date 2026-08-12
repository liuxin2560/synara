import type {
  RemoteCodexThreadStatus,
  RemoteCodexThreadSummary,
  RemoteListCodexThreadsInput,
  RemoteListCodexThreadsResult,
} from "@synara/contracts";

import { withRemoteCodexAppServer } from "./remoteCodexAppServer";

type AppServerRequest = <T>(method: string, params: unknown) => Promise<T>;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function numberValue(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

function threadStatus(value: unknown): RemoteCodexThreadStatus {
  const type = stringValue(asRecord(value) ?? {}, "type");
  return type === "notLoaded" || type === "idle" || type === "systemError" || type === "active"
    ? type
    : "unknown";
}

function sessionSource(value: unknown): string {
  if (typeof value === "string" && value.trim()) return value.trim().slice(0, 255);
  const record = asRecord(value);
  const custom = record ? stringValue(record, "custom") : undefined;
  if (custom) return custom.slice(0, 255);
  return record && "subAgent" in record ? "subAgent" : "unknown";
}

function threadTitle(record: Record<string, unknown>, threadId: string): string {
  const name = stringValue(record, "name");
  if (name) return name.slice(0, 240);
  const preview = stringValue(record, "preview")?.split(/\r?\n/, 1)[0]?.trim();
  return (preview || threadId).slice(0, 240);
}

export function parseRemoteCodexThreadList(
  hostAlias: string,
  response: unknown,
): RemoteListCodexThreadsResult {
  const responseRecord = asRecord(response);
  if (!responseRecord || !Array.isArray(responseRecord.data)) {
    throw new Error("Remote Codex thread/list returned an invalid response.");
  }

  const threads = responseRecord.data.flatMap((value): RemoteCodexThreadSummary[] => {
    const record = asRecord(value);
    if (!record) return [];
    const threadId = stringValue(record, "id");
    const cwd = stringValue(record, "cwd");
    if (!threadId || !cwd) return [];
    const parentThreadId = stringValue(record, "parentThreadId");
    return [
      {
        hostAlias: hostAlias as RemoteCodexThreadSummary["hostAlias"],
        threadId: threadId.slice(0, 255),
        title: threadTitle(record, threadId),
        preview: (stringValue(record, "preview") ?? "").slice(0, 2_000),
        cwd: cwd.slice(0, 4_096),
        createdAt: numberValue(record, "createdAt"),
        updatedAt: numberValue(record, "updatedAt"),
        status: threadStatus(record.status),
        source: sessionSource(record.source),
        ...(parentThreadId ? { parentThreadId: parentThreadId.slice(0, 255) } : {}),
      },
    ];
  });
  const nextCursor = responseRecord.nextCursor;
  if (nextCursor !== null && nextCursor !== undefined && typeof nextCursor !== "string") {
    throw new Error("Remote Codex thread/list returned an invalid cursor.");
  }
  return { threads, nextCursor: nextCursor?.trim() || null };
}

export async function listRemoteCodexThreads(
  input: RemoteListCodexThreadsInput,
  request?: AppServerRequest,
): Promise<RemoteListCodexThreadsResult> {
  const params = {
    limit: input.limit ?? 50,
    sortKey: "updated_at",
    sortDirection: "desc",
    archived: false,
    ...(input.cursor ? { cursor: input.cursor } : {}),
    ...(input.cwd ? { cwd: input.cwd } : {}),
  };
  if (request) {
    return parseRemoteCodexThreadList(input.alias, await request("thread/list", params));
  }
  return withRemoteCodexAppServer(input.alias, async (client) =>
    parseRemoteCodexThreadList(
      input.alias,
      await client.request("thread/list", params),
    ),
  );
}
