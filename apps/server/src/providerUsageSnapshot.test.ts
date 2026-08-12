import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { readCodexSessionSummary } from "./providerUsageSnapshot";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

async function temporarySessionPath(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "synara-usage-tail-"));
  temporaryDirectories.push(directory);
  return path.join(directory, "rollout.jsonl");
}

describe("Codex local usage archive", () => {
  it("reads the latest token count from the tail without retaining a huge later row", async () => {
    const sessionPath = await temporarySessionPath();
    const tokenCount = JSON.stringify({
      timestamp: "2026-08-12T01:02:03.000Z",
      type: "event_msg",
      payload: {
        type: "token_count",
        info: { total_token_usage: { total_tokens: 123_456 } },
      },
    });
    const hugeIrrelevantRow = JSON.stringify({ type: "event_msg", payload: "x".repeat(2_000_000) });
    await fs.writeFile(sessionPath, `${tokenCount}\n${hugeIrrelevantRow}\n`, "utf8");

    await expect(readCodexSessionSummary(sessionPath)).resolves.toMatchObject({
      timestampMs: Date.parse("2026-08-12T01:02:03.000Z"),
      totalTokens: 123_456,
    });
  });

  it("accepts a final token-count row without a trailing newline", async () => {
    const sessionPath = await temporarySessionPath();
    await fs.writeFile(
      sessionPath,
      JSON.stringify({
        timestamp: "2026-08-12T04:05:06.000Z",
        type: "event_msg",
        payload: { type: "token_count", total_tokens: 42 },
      }),
      "utf8",
    );

    await expect(readCodexSessionSummary(sessionPath)).resolves.toMatchObject({
      totalTokens: 42,
    });
  });
});
