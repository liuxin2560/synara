import { describe, expect, it, vi } from "vitest";

import type { ProcessRunResult } from "../processRunner";
import { classifySshConnectionFailure, probeSshConnection } from "./sshConnection";

function processResult(overrides: Partial<ProcessRunResult> = {}): ProcessRunResult {
  return {
    stdout: "",
    stderr: "",
    code: 0,
    signal: null,
    timedOut: false,
    stdoutTruncated: false,
    stderrTruncated: false,
    ...overrides,
  };
}

describe("SSH connection probing", () => {
  it.each([
    ["Permission denied (publickey).", "auth-required"],
    ["WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!", "host-key-error"],
    ["ssh: Could not resolve hostname cluster", "unreachable"],
    ["Connection timed out", "unreachable"],
    ["unexpected ssh failure", "error"],
  ] as const)("classifies %s", (detail, state) => {
    expect(classifySshConnectionFailure(detail)).toBe(state);
  });

  it("uses a non-interactive OpenSSH probe", async () => {
    const runner = vi.fn(async () => processResult());

    await expect(probeSshConnection("cluster", runner)).resolves.toEqual({ state: "ready" });
    expect(runner).toHaveBeenCalledWith(
      "ssh",
      [
        "-T",
        "-o",
        "BatchMode=yes",
        "-o",
        "ConnectTimeout=10",
        "-o",
        "ConnectionAttempts=1",
        "cluster",
        "true",
      ],
      {
        timeoutMs: 15_000,
        maxBufferBytes: 32 * 1024,
        outputMode: "truncate",
        allowNonZeroExit: true,
      },
    );
  });

  it("returns an actionable state without throwing when authentication fails", async () => {
    const runner = vi.fn(async () =>
      processResult({ code: 255, stderr: "Permission denied (publickey)." }),
    );

    await expect(probeSshConnection("cluster", runner)).resolves.toEqual({
      state: "auth-required",
      lastError: "Permission denied (publickey).",
    });
  });

  it("rejects option-like aliases before spawning ssh", async () => {
    const runner = vi.fn(async () => processResult());

    await expect(probeSshConnection("-oProxyCommand=bad", runner)).rejects.toThrow(
      "Invalid SSH Host alias",
    );
    expect(runner).not.toHaveBeenCalled();
  });
});
