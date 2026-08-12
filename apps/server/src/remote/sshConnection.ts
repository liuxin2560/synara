import type { RemoteConnectionState } from "@synara/contracts";

import { runProcess, type ProcessRunResult } from "../processRunner";
import { isConcreteSshHostAlias } from "./sshConfig";

const SSH_PROBE_OUTPUT_LIMIT_BYTES = 32 * 1024;
const SSH_PROBE_PROCESS_TIMEOUT_MS = 15_000;

type ProbeRunner = (
  command: string,
  args: readonly string[],
  options: {
    timeoutMs: number;
    maxBufferBytes: number;
    outputMode: "truncate";
    allowNonZeroExit: true;
  },
) => Promise<ProcessRunResult>;

export interface SshConnectionProbeResult {
  state: Exclude<RemoteConnectionState, "disconnected" | "connecting" | "incompatible">;
  lastError?: string | undefined;
}

function boundedErrorDetail(result: ProcessRunResult): string | undefined {
  const detail = (result.stderr.trim() || result.stdout.trim()).slice(0, 2_000);
  return detail.length > 0 ? detail : undefined;
}

export function classifySshConnectionFailure(detail: string): SshConnectionProbeResult["state"] {
  if (
    /remote host identification has changed|host key verification failed|no .* host key is known/i.test(
      detail,
    )
  ) {
    return "host-key-error";
  }
  if (/permission denied|authentication failed|no supported authentication methods/i.test(detail)) {
    return "auth-required";
  }
  if (
    /could not resolve hostname|name or service not known|nodename nor servname provided|connection (?:timed out|refused|closed)|operation timed out|no route to host|network is unreachable/i.test(
      detail,
    )
  ) {
    return "unreachable";
  }
  return "error";
}

export async function probeSshConnection(
  alias: string,
  runner: ProbeRunner = runProcess,
): Promise<SshConnectionProbeResult> {
  if (!isConcreteSshHostAlias(alias)) throw new Error(`Invalid SSH Host alias: ${alias}`);

  try {
    const result = await runner(
      "ssh",
      [
        "-T",
        "-o",
        "BatchMode=yes",
        "-o",
        "ConnectTimeout=10",
        "-o",
        "ConnectionAttempts=1",
        alias,
        "true",
      ],
      {
        timeoutMs: SSH_PROBE_PROCESS_TIMEOUT_MS,
        maxBufferBytes: SSH_PROBE_OUTPUT_LIMIT_BYTES,
        outputMode: "truncate",
        allowNonZeroExit: true,
      },
    );
    if (result.code === 0 && !result.timedOut) return { state: "ready" };

    const lastError = boundedErrorDetail(result) ?? `SSH exited with code ${result.code ?? "null"}.`;
    return {
      state: result.timedOut ? "unreachable" : classifySshConnectionFailure(lastError),
      lastError,
    };
  } catch (error) {
    const lastError = (error instanceof Error ? error.message : String(error)).slice(0, 2_000);
    return { state: classifySshConnectionFailure(lastError), lastError };
  }
}
