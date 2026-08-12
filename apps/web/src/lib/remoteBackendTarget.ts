// FILE: remoteBackendTarget.ts
// Purpose: Describes a remote Codex session and isolates its Synara backend inside a detail frame.
// Layer: Web runtime routing utility
// Exports: target parsing, session-scoped selection persistence, and frame URL helpers

const REMOTE_THREAD_SELECTION_STORAGE_KEY_PREFIX = "synara.remote-thread-selection.v1:";
const REMOTE_FRAME_NAME_PREFIX = "synara-remote-thread-frame:v1:";

export type RemoteCodexOpenMode = "copy" | "resume-original";

export interface PendingRemoteCodexThread {
  readonly importId: string;
  readonly synaraThreadId: string;
  readonly externalId: string;
  readonly title: string;
  readonly cwd: string;
  readonly mode: RemoteCodexOpenMode;
}

export interface ActiveRemoteBackendTarget {
  readonly version: 1;
  readonly alias: string;
  readonly httpUrl: string;
  readonly pendingThread?: PendingRemoteCodexThread;
}

type StorageLike = Pick<Storage, "getItem" | "removeItem" | "setItem">;

function nonEmptyBoundedString(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maxLength;
}

export function normalizeRemoteBackendHttpUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "http:" ||
      url.hostname !== "127.0.0.1" ||
      url.port.length === 0 ||
      url.username.length > 0 ||
      url.password.length > 0 ||
      (url.pathname !== "/" && url.pathname !== "") ||
      url.search.length > 0 ||
      url.hash.length > 0
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

function parsePendingThread(value: unknown): PendingRemoteCodexThread | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  if (
    !nonEmptyBoundedString(candidate.importId, 255) ||
    !nonEmptyBoundedString(candidate.synaraThreadId, 255) ||
    !nonEmptyBoundedString(candidate.externalId, 255) ||
    !nonEmptyBoundedString(candidate.title, 240) ||
    !nonEmptyBoundedString(candidate.cwd, 4_096) ||
    (candidate.mode !== "copy" && candidate.mode !== "resume-original")
  ) {
    return undefined;
  }
  return {
    importId: candidate.importId,
    synaraThreadId: candidate.synaraThreadId,
    externalId: candidate.externalId,
    title: candidate.title,
    cwd: candidate.cwd,
    mode: candidate.mode,
  };
}

export function parseActiveRemoteBackendTarget(raw: string | null): ActiveRemoteBackendTarget | null {
  if (!raw) return null;
  try {
    const candidate = JSON.parse(raw) as unknown;
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
    const record = candidate as Record<string, unknown>;
    const httpUrl = normalizeRemoteBackendHttpUrl(record.httpUrl);
    if (record.version !== 1 || !nonEmptyBoundedString(record.alias, 255) || !httpUrl) return null;
    const pendingThread = parsePendingThread(record.pendingThread);
    if (record.pendingThread !== undefined && !pendingThread) return null;
    return {
      version: 1,
      alias: record.alias,
      httpUrl,
      ...(pendingThread ? { pendingThread } : {}),
    };
  } catch {
    return null;
  }
}

function browserSessionStorage(): StorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function selectionStorageKey(selectionId: string): string {
  return `${REMOTE_THREAD_SELECTION_STORAGE_KEY_PREFIX}${selectionId}`;
}

export function remoteThreadSelectionId(target: ActiveRemoteBackendTarget): string {
  const selectionId = target.pendingThread?.importId;
  if (!selectionId) throw new Error("Remote thread target does not contain a session selection.");
  return selectionId;
}

export function writeRemoteThreadSelection(
  target: ActiveRemoteBackendTarget,
  storage: StorageLike | null = browserSessionStorage(),
): string {
  if (!storage) throw new Error("Session storage is unavailable.");
  const validated = parseActiveRemoteBackendTarget(JSON.stringify(target));
  if (!validated?.pendingThread) throw new Error("Remote thread target is invalid.");
  const selectionId = remoteThreadSelectionId(validated);
  storage.setItem(selectionStorageKey(selectionId), JSON.stringify(validated));
  return selectionId;
}

export function readRemoteThreadSelection(
  selectionId: string,
  storage: StorageLike | null = browserSessionStorage(),
): ActiveRemoteBackendTarget | null {
  if (!storage || !nonEmptyBoundedString(selectionId, 255)) return null;
  try {
    return parseActiveRemoteBackendTarget(storage.getItem(selectionStorageKey(selectionId)));
  } catch {
    return null;
  }
}

export function clearRemoteThreadSelection(
  selectionId: string,
  storage: StorageLike | null = browserSessionStorage(),
): void {
  try {
    storage?.removeItem(selectionStorageKey(selectionId));
  } catch {
    // Session selections are disposable; storage cleanup remains best effort.
  }
}

export function remoteBackendWsUrl(target: ActiveRemoteBackendTarget): string {
  const url = new URL(target.httpUrl);
  url.protocol = "ws:";
  return url.toString();
}

export interface RemoteThreadFrameIdentity {
  readonly version: 1;
  readonly selectionId: string;
  readonly httpUrl: string;
}

export function serializeRemoteThreadFrameName(target: ActiveRemoteBackendTarget): string {
  return `${REMOTE_FRAME_NAME_PREFIX}${JSON.stringify({
    version: 1,
    selectionId: remoteThreadSelectionId(target),
    httpUrl: target.httpUrl,
  })}`;
}

export function parseRemoteThreadFrameName(value: string | null): RemoteThreadFrameIdentity | null {
  if (!value?.startsWith(REMOTE_FRAME_NAME_PREFIX)) return null;
  try {
    const candidate = JSON.parse(value.slice(REMOTE_FRAME_NAME_PREFIX.length)) as unknown;
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
    const record = candidate as Record<string, unknown>;
    const httpUrl = normalizeRemoteBackendHttpUrl(record.httpUrl);
    if (record.version !== 1 || !nonEmptyBoundedString(record.selectionId, 255) || !httpUrl) {
      return null;
    }
    return { version: 1, selectionId: record.selectionId, httpUrl };
  } catch {
    return null;
  }
}

function browserRemoteFrameIdentity(): RemoteThreadFrameIdentity | null {
  if (typeof window === "undefined") return null;
  try {
    if (window.parent === window) return null;
    return parseRemoteThreadFrameName(window.name);
  } catch {
    return null;
  }
}

export function readRemoteThreadFrameSelectionId(frameName?: string): string | null {
  const identity =
    frameName === undefined ? browserRemoteFrameIdentity() : parseRemoteThreadFrameName(frameName);
  return identity?.selectionId ?? null;
}

export function readRemoteFrameBackendWsUrl(frameName?: string): string | null {
  const identity =
    frameName === undefined ? browserRemoteFrameIdentity() : parseRemoteThreadFrameName(frameName);
  if (!identity) return null;
  try {
    const wsUrl = new URL(identity.httpUrl);
    wsUrl.protocol = "ws:";
    return wsUrl.toString();
  } catch {
    return null;
  }
}

export function isRemoteThreadFrame(frameName?: string): boolean {
  return readRemoteFrameBackendWsUrl(frameName) !== null;
}

export function buildRemoteThreadFrameUrl(currentUrl: string): string {
  const nextUrl = new URL(currentUrl);
  nextUrl.search = "";
  nextUrl.hash = "/";
  return nextUrl.toString();
}

export function buildActiveRemoteBackendTarget(input: {
  readonly alias: string;
  readonly httpUrl: string;
  readonly thread: {
    readonly externalId: string;
    readonly title: string;
    readonly cwd: string;
  };
  readonly randomId?: () => string;
}): ActiveRemoteBackendTarget {
  const randomId = input.randomId ?? (() => crypto.randomUUID());
  return {
    version: 1,
    alias: input.alias,
    httpUrl: input.httpUrl,
    pendingThread: {
      importId: randomId(),
      synaraThreadId: randomId(),
      externalId: input.thread.externalId,
      title: input.thread.title,
      cwd: input.thread.cwd,
      mode: "resume-original",
    },
  };
}

export function replacePendingRemoteThread(
  target: ActiveRemoteBackendTarget,
  pendingThread: PendingRemoteCodexThread | undefined,
): ActiveRemoteBackendTarget {
  return {
    version: 1,
    alias: target.alias,
    httpUrl: target.httpUrl,
    ...(pendingThread ? { pendingThread } : {}),
  };
}
