import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  RemoteEnvironmentConnection,
  RemoteListSshHostsResult,
  RemoteListCodexThreadsInput,
  RemoteProbeSshHostInput,
  SshHostAlias,
  SshHostConfigSummary,
} from "./remote";

describe("SSH remote contracts", () => {
  it.each(["cluster", "gpu-01", "user@bastion", "10.0.0.4"])(
    "accepts concrete Host alias %s",
    (alias) => {
      expect(Schema.decodeUnknownSync(SshHostAlias)(alias)).toBe(alias);
    },
  );

  it.each(["*", "gpu-*", "!blocked", "-oProxyCommand=bad", "two hosts", "host[0-9]"])(
    "rejects non-concrete or unsafe Host alias %s",
    (alias) => {
      expect(() => Schema.decodeUnknownSync(SshHostAlias)(alias)).toThrow();
    },
  );

  it("keeps private OpenSSH details out of the public host summary", () => {
    const decoded = Schema.decodeUnknownSync(SshHostConfigSummary)({
      alias: "cluster",
      hostname: "cluster.example.com",
      user: "liuxin",
      port: 22,
      proxyJump: "bastion",
      identityFiles: ["~/.ssh/id_ed25519"],
    });

    expect(decoded).toEqual({
      alias: "cluster",
      hostname: "cluster.example.com",
      user: "liuxin",
      port: 22,
      proxyJump: "bastion",
    });
  });

  it("represents a ready remote environment without duplicating its identity", () => {
    const decoded = Schema.decodeUnknownSync(RemoteEnvironmentConnection)({
      transport: "ssh",
      host: {
        alias: "cluster",
        hostname: "cluster.example.com",
        user: "liuxin",
        port: 22,
      },
      state: "ready",
      environment: {
        environmentId: "environment-1",
        label: "cluster",
        platform: { os: "linux", arch: "x64" },
        serverVersion: "0.7.1",
        capabilities: { repositoryIdentity: true },
      },
    });

    expect(decoded.environment?.environmentId).toBe("environment-1");
  });

  it("keeps per-host discovery failures visible without hiding healthy hosts", () => {
    const decoded = Schema.decodeUnknownSync(RemoteListSshHostsResult)({
      hosts: [{ alias: "cluster", hostname: "10.0.0.8", user: "liuxin", port: 22 }],
      errors: [{ alias: "broken", message: "OpenSSH could not resolve this host." }],
    });

    expect(decoded.hosts).toHaveLength(1);
    expect(decoded.errors).toHaveLength(1);
  });

  it("rejects option injection at the probe RPC boundary", () => {
    expect(() =>
      Schema.decodeUnknownSync(RemoteProbeSshHostInput)({ alias: "-oProxyCommand=bad" }),
    ).toThrow();
  });

  it("accepts an omitted remote Codex page size for the server default", () => {
    expect(
      Schema.decodeUnknownSync(RemoteListCodexThreadsInput)({ alias: "cluster" }),
    ).toEqual({ alias: "cluster" });
  });
});
