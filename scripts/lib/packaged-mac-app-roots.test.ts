import assert from "node:assert/strict";
import { describe, it } from "vitest";

import { resolvePackagedMacAppRoots } from "./packaged-mac-app-roots";

describe("packaged macOS app roots", () => {
  it("ignores DMG and update files before probing inside candidate directories", () => {
    assert.deepStrictEqual(
      resolvePackagedMacAppRoots({
        stageDistDir: "/tmp/dist",
        productName: "Synara",
        entries: [
          { name: "Synara-0.7.1-arm64.dmg", type: "File" },
          { name: "Synara-0.7.1-arm64.zip", type: "File" },
          { name: "latest-mac.yml", type: "File" },
          { name: "mac-arm64", type: "Directory" },
        ],
      }),
      ["/tmp/dist/mac-arm64/Synara.app"],
    );
  });
});
