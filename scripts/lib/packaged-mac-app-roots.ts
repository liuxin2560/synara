import { join } from "node:path";

export interface MacDistEntry {
  readonly name: string;
  readonly type: string;
}

export function resolvePackagedMacAppRoots(input: {
  readonly stageDistDir: string;
  readonly productName: string;
  readonly entries: readonly MacDistEntry[];
}): string[] {
  return input.entries
    .filter((entry) => entry.type === "Directory")
    .map((entry) => join(input.stageDistDir, entry.name, `${input.productName}.app`));
}
