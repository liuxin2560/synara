import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ProcessRunResult } from "../processRunner";
import {
  discoverOpenSshHostAliases,
  discoverOpenSshHosts,
  parseOpenSshConfig,
  parseOpenSshConfigDump,
} from "./sshConfig";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true })),
  );
});

describe("OpenSSH host discovery", () => {
  it("extracts concrete aliases and ignores pattern-only entries", () => {
    expect(
      parseOpenSshConfig(`
        Host cluster cluster2 gpu-*
        Host !blocked *
        Host="quoted-host" "host with spaces"
        Include conf.d/*.conf # trailing comment
      `),
    ).toEqual({
      aliases: ["cluster", "cluster2", "quoted-host"],
      includes: ["conf.d/*.conf"],
    });
  });

  it("follows Includes, prevents cycles, and de-duplicates aliases", async () => {
    const homeDir = await mkdtemp(path.join(tmpdir(), "synara-ssh-config-"));
    temporaryDirectories.push(homeDir);
    const sshDir = path.join(homeDir, ".ssh");
    await mkdir(path.join(sshDir, "conf.d"), { recursive: true });
    await writeFile(
      path.join(sshDir, "config"),
      "Host primary\nInclude conf.d/*.conf\n",
      "utf8",
    );
    await writeFile(
      path.join(sshDir, "conf.d", "cluster.conf"),
      "Host cluster PRIMARY\nInclude config\n",
      "utf8",
    );

    await expect(discoverOpenSshHostAliases({ homeDir })).resolves.toEqual([
      "primary",
      "cluster",
    ]);
  });

  it("returns no hosts when the user has no SSH config", async () => {
    const homeDir = await mkdtemp(path.join(tmpdir(), "synara-ssh-empty-"));
    temporaryDirectories.push(homeDir);

    await expect(discoverOpenSshHostAliases({ homeDir })).resolves.toEqual([]);
  });

  it("parses the public subset of ssh -G output", () => {
    expect(
      parseOpenSshConfigDump(
        "cluster",
        "host cluster\nuser liuxin\nhostname 10.0.0.8\nport 2222\nproxyjump bastion\nidentityfile ~/.ssh/id_ed25519\n",
      ),
    ).toEqual({
      alias: "cluster",
      hostname: "10.0.0.8",
      user: "liuxin",
      port: 2222,
      proxyJump: "bastion",
    });
  });

  it("resolves every discovered alias through OpenSSH without connecting", async () => {
    const homeDir = await mkdtemp(path.join(tmpdir(), "synara-ssh-resolve-"));
    temporaryDirectories.push(homeDir);
    await mkdir(path.join(homeDir, ".ssh"), { recursive: true });
    await writeFile(path.join(homeDir, ".ssh", "config"), "Host cluster\n", "utf8");

    const runner = vi.fn(async (): Promise<ProcessRunResult> => ({
      stdout: "user liuxin\nhostname cluster.example.com\nport 22\n",
      stderr: "",
      code: 0,
      signal: null,
      timedOut: false,
      stdoutTruncated: false,
      stderrTruncated: false,
    }));

    await expect(discoverOpenSshHosts({ homeDir, runner })).resolves.toEqual([
      {
        alias: "cluster",
        hostname: "cluster.example.com",
        user: "liuxin",
        port: 22,
      },
    ]);
    expect(runner).toHaveBeenCalledWith("ssh", ["-G", "cluster"], {
      timeoutMs: 10_000,
      maxBufferBytes: 256 * 1024,
      outputMode: "truncate",
    });
  });
});
