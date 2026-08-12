import { glob, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { SshHostConfigSummary } from "@synara/contracts";

import { runProcess, type ProcessRunResult } from "../processRunner";

const SSH_CONFIG_OUTPUT_LIMIT_BYTES = 256 * 1024;
const SSH_CONFIG_TIMEOUT_MS = 10_000;

interface ParsedSshConfig {
  aliases: string[];
  includes: string[];
}

type ProcessRunner = (
  command: string,
  args: readonly string[],
  options: {
    timeoutMs: number;
    maxBufferBytes: number;
    outputMode: "truncate";
  },
) => Promise<ProcessRunResult>;

export interface DiscoverOpenSshHostsOptions {
  configPath?: string | undefined;
  homeDir?: string | undefined;
  runner?: ProcessRunner | undefined;
}

function tokenizeDirectiveValue(value: string): string[] {
  const tokens: string[] = [];
  let token = "";
  let quote: "'" | '"' | null = null;
  let escaped = false;

  const pushToken = (): void => {
    if (token.length === 0) return;
    tokens.push(token);
    token = "";
  };

  for (const character of value) {
    if (escaped) {
      token += character;
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = null;
      else token += character;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === "#") break;
    if (/\s/.test(character)) {
      pushToken();
      continue;
    }
    token += character;
  }

  if (escaped) token += "\\";
  pushToken();
  return tokens;
}

function parseDirective(line: string): { keyword: string; values: string[] } | null {
  const match = /^\s*([A-Za-z][A-Za-z0-9-]*)\s*(?:=\s*|\s+)(.*)$/.exec(line);
  if (!match) return null;
  const keyword = match[1];
  const value = match[2];
  if (!keyword || value === undefined) return null;
  return { keyword: keyword.toLowerCase(), values: tokenizeDirectiveValue(value) };
}

export function isConcreteSshHostAlias(alias: string): boolean {
  return (
    alias.length > 0 &&
    alias.length <= 255 &&
    !alias.startsWith("-") &&
    !/[\s*?!\[\]]/.test(alias)
  );
}

export function parseOpenSshConfig(config: string): ParsedSshConfig {
  const aliases: string[] = [];
  const includes: string[] = [];

  for (const line of config.split(/\r?\n/)) {
    const directive = parseDirective(line);
    if (!directive) continue;
    if (directive.keyword === "host") {
      aliases.push(...directive.values.filter(isConcreteSshHostAlias));
    } else if (directive.keyword === "include") {
      includes.push(...directive.values);
    }
  }

  return { aliases, includes };
}

function expandHome(input: string, homeDir: string): string {
  if (input === "~") return homeDir;
  if (input.startsWith("~/")) return path.join(homeDir, input.slice(2));
  return input;
}

async function discoverAliasesFromFile(
  configPath: string,
  options: { homeDir: string; relativeIncludeRoot: string; visited: Set<string> },
): Promise<string[]> {
  const normalizedPath = path.resolve(configPath);
  if (options.visited.has(normalizedPath)) return [];
  options.visited.add(normalizedPath);

  let contents: string;
  try {
    contents = await readFile(normalizedPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }

  const parsed = parseOpenSshConfig(contents);
  const aliases = [...parsed.aliases];
  for (const include of parsed.includes) {
    const expanded = expandHome(include, options.homeDir);
    const pattern = path.isAbsolute(expanded)
      ? expanded
      : path.resolve(options.relativeIncludeRoot, expanded);
    const matches = [];
    for await (const match of glob(pattern, { onlyFiles: true })) matches.push(match);
    matches.sort();
    for (const match of matches) {
      aliases.push(...(await discoverAliasesFromFile(match, options)));
    }
  }
  return aliases;
}

export async function discoverOpenSshHostAliases(
  options: Pick<DiscoverOpenSshHostsOptions, "configPath" | "homeDir"> = {},
): Promise<string[]> {
  const homeDir = options.homeDir ?? homedir();
  const configPath = options.configPath ?? path.join(homeDir, ".ssh", "config");
  const aliases = await discoverAliasesFromFile(configPath, {
    homeDir,
    relativeIncludeRoot: path.join(homeDir, ".ssh"),
    visited: new Set(),
  });

  const seen = new Set<string>();
  return aliases.filter((alias) => {
    const key = alias.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function parseOpenSshConfigDump(alias: string, dump: string): SshHostConfigSummary {
  if (!isConcreteSshHostAlias(alias)) throw new Error(`Invalid SSH Host alias: ${alias}`);

  const values = new Map<string, string>();
  for (const line of dump.split(/\r?\n/)) {
    const separator = line.search(/\s/);
    if (separator <= 0) continue;
    const key = line.slice(0, separator).toLowerCase();
    const value = line.slice(separator).trim();
    if (value.length > 0 && !values.has(key)) values.set(key, value);
  }

  const hostname = values.get("hostname") ?? alias;
  const user = values.get("user");
  if (!user) throw new Error(`OpenSSH did not resolve a user for Host ${alias}.`);
  if (hostname.length > 255 || user.length > 255) {
    throw new Error(`OpenSSH resolved an invalid endpoint for Host ${alias}.`);
  }
  const parsedPort = Number(values.get("port") ?? "22");
  if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65_535) {
    throw new Error(`OpenSSH resolved an invalid port for Host ${alias}.`);
  }
  const proxyJump = values.get("proxyjump");
  if (proxyJump && proxyJump.length > 2_048) {
    throw new Error(`OpenSSH resolved an invalid ProxyJump for Host ${alias}.`);
  }

  return {
    alias: alias as SshHostConfigSummary["alias"],
    hostname,
    user,
    port: parsedPort,
    ...(proxyJump && proxyJump.toLowerCase() !== "none" ? { proxyJump } : {}),
  };
}

export async function resolveOpenSshHost(
  alias: string,
  runner: ProcessRunner = runProcess,
): Promise<SshHostConfigSummary> {
  if (!isConcreteSshHostAlias(alias)) throw new Error(`Invalid SSH Host alias: ${alias}`);
  const result = await runner("ssh", ["-G", alias], {
    timeoutMs: SSH_CONFIG_TIMEOUT_MS,
    maxBufferBytes: SSH_CONFIG_OUTPUT_LIMIT_BYTES,
    outputMode: "truncate",
  });
  if (result.stdoutTruncated) {
    throw new Error(`OpenSSH configuration for Host ${alias} exceeded the output limit.`);
  }
  return parseOpenSshConfigDump(alias, result.stdout);
}

export async function discoverOpenSshHosts(
  options: DiscoverOpenSshHostsOptions = {},
): Promise<SshHostConfigSummary[]> {
  const aliases = await discoverOpenSshHostAliases(options);
  const runner = options.runner ?? runProcess;
  return Promise.all(aliases.map((alias) => resolveOpenSshHost(alias, runner)));
}
