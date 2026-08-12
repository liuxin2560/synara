// FILE: remoteBackendTarget.ts
// Purpose: Persists one SSH-tunnelled Synara backend across a renderer reload.
// Layer: Web runtime routing utility
// Exports: target parsing, activation, pending-import updates, and local-backend return helpers

const REMOTE_BACKEND_STORAGE_KEY = "synara.active-remote-backend.v1";

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

export function readActiveRemoteBackendTarget(
  storage: StorageLike | null = browserSessionStorage(),
): ActiveRemoteBackendTarget | null {
  if (!storage) return null;
  try {
    return parseActiveRemoteBackendTarget(storage.getItem(REMOTE_BACKEND_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function writeActiveRemoteBackendTarget(
  target: ActiveRemoteBackendTarget,
  storage: StorageLike | null = browserSessionStorage(),
): void {
  if (!storage) throw new Error("Session storage is unavailable.");
  const validated = parseActiveRemoteBackendTarget(JSON.stringify(target));
  if (!validated) throw new Error("Remote backend target is invalid.");
  storage.setItem(REMOTE_BACKEND_STORAGE_KEY, JSON.stringify(validated));
}

export function clearActiveRemoteBackendTarget(
  storage: StorageLike | null = browserSessionStorage(),
): void {
  try {
    storage?.removeItem(REMOTE_BACKEND_STORAGE_KEY);
  } catch {
    // Returning to the local backend is best-effort when storage is unavailable.
  }
}

export function remoteBackendWsUrl(target: ActiveRemoteBackendTarget): string {
  const url = new URL(target.httpUrl);
  url.protocol = "ws:";
  return url.toString();
}

export function readActiveRemoteBackendWsUrl(): string | null {
  const target = readActiveRemoteBackendTarget();
  return target ? remoteBackendWsUrl(target) : null;
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

export function reloadAppAtRoot(): void {
  if (typeof window === "undefined") return;
  if (window.desktopBridge) {
    const nextUrl = new URL(window.location.href);
    nextUrl.hash = "/";
    window.location.replace(nextUrl.toString());
    return;
  }
  window.history.replaceState(null, "", "/");
  window.location.reload();
}
