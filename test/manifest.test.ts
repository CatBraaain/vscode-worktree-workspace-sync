import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"),
) as Record<string, never>;

// SPEC 対象と適用範囲/起動 + 設定: the manifest is the declaration-level
// part of the observable behavior (activation timing, defaults).
describe("extension manifest", () => {
  it("activates after editor startup when workspace folders are open", () => {
    expect(pkg.activationEvents).toContain("onStartupFinished");
  });

  it("loads the esbuild bundle as the extension main", () => {
    expect(pkg.main).toBe("./dist/extension.js");
  });

  it("contributes worktreeWorkspaceSync settings with the spec defaults", () => {
    const properties = (
      pkg.contributes as unknown as {
        configuration: { properties: Record<string, Record<string, unknown>> };
      }
    ).configuration.properties;

    expect(properties["worktreeWorkspaceSync.enabled"]).toMatchObject({
      type: "boolean",
      default: true,
    });
    expect(properties["worktreeWorkspaceSync.pollIntervalMs"]).toMatchObject({
      type: "number",
      default: 2500,
    });
    expect(properties["worktreeWorkspaceSync.roots"]).toMatchObject({
      type: "array",
      default: [],
    });
  });
});
