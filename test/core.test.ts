import { describe, expect, it } from "vitest";
import {
  computeSyncDiff,
  effectivePollIntervalMs,
  filterTargetEntries,
  folderNameFor,
  isStrictlyUnder,
} from "../src/core";
import { wt } from "./helpers/fake";

const MAIN = "/repo";

function targetPaths(entries: ReturnType<typeof filterTargetEntries>): string[] {
  return entries.map((entry) => entry.path);
}

const ENTRIES = [
  wt(MAIN, { branch: "main" }),
  wt("/repo/.claude/worktrees/a", { branch: "feat-a" }),
  wt("/wt/b", { branch: "b" }),
  wt("/wt/c", { branch: "c" }),
  wt("/other/d", { branch: "d" }),
  wt("/gone", {
    branch: "gone",
    prunable: true,
  }),
  wt("/repo/wt/rel", { branch: "rel" }),
];

// SPEC 設定/pollIntervalMs: the effective interval is max(requested, 500).
describe("effectivePollIntervalMs", () => {
  it("clamps small and non-positive values to 500", () => {
    expect(effectivePollIntervalMs(100)).toBe(500);
    expect(effectivePollIntervalMs(0)).toBe(500);
    expect(effectivePollIntervalMs(-1)).toBe(500);
  });

  it("keeps values of 500 and above", () => {
    expect(effectivePollIntervalMs(500)).toBe(500);
    expect(effectivePollIntervalMs(2500)).toBe(2500);
  });
});

// SPEC 設定/roots: filtering (strict descendants only).
describe("filterTargetEntries", () => {
  it("with empty roots targets every living worktree except the main repository and prunable entries", () => {
    expect(targetPaths(filterTargetEntries(ENTRIES, MAIN, []))).toEqual([
      "/repo/.claude/worktrees/a",
      "/wt/b",
      "/wt/c",
      "/other/d",
      "/repo/wt/rel",
    ]);
  });

  it("with non-empty roots targets only worktrees strictly below a root", () => {
    expect(targetPaths(filterTargetEntries(ENTRIES, MAIN, ["/wt"]))).toEqual(["/wt/b", "/wt/c"]);
  });

  it("excludes a worktree whose path equals a root", () => {
    expect(targetPaths(filterTargetEntries(ENTRIES, MAIN, ["/wt/b"]))).toEqual([]);
  });

  it("resolves relative roots against the main repository", () => {
    expect(targetPaths(filterTargetEntries(ENTRIES, MAIN, ["wt"]))).toEqual(["/repo/wt/rel"]);
  });
});

describe("isStrictlyUnder", () => {
  it("accepts descendants and rejects equal or outside paths", () => {
    expect(isStrictlyUnder("/a/b/c", "/a/b")).toBe(true);
    expect(isStrictlyUnder("/a/b", "/a/b")).toBe(false);
    expect(isStrictlyUnder("/a/b2", "/a/b")).toBe(false);
    expect(isStrictlyUnder("/x", "/a/b")).toBe(false);
  });
});

// SPEC 同期の定義/フォルダ名: folder naming.
describe("folderNameFor", () => {
  it("uses the branch name", () => {
    expect(folderNameFor(wt("/repo/wt/x", { branch: "feat/nested" }))).toBe("feat/nested");
  });

  it("uses (detached <first 7 of HEAD>) without a branch", () => {
    expect(folderNameFor(wt("/repo/wt/x", { head: "abcdef1234567890" }))).toBe(
      "(detached abcdef1)",
    );
  });

  it('appends "  ·  agent" below .claude/worktrees', () => {
    expect(folderNameFor(wt("/repo/.claude/worktrees/x", { branch: "feat-x" }))).toBe(
      "feat-x  ·  agent",
    );
    expect(folderNameFor(wt("/repo/.claude/worktrees/x", { head: "abcdef1234567890" }))).toBe(
      "(detached abcdef1)  ·  agent",
    );
    expect(folderNameFor(wt("C:\\repo\\.claude\\worktrees\\x", { branch: "feat-x" }))).toBe(
      "feat-x  ·  agent",
    );
  });
});

// Supports SPEC 同期の定義/変化表: diff of targets vs workspace.
describe("computeSyncDiff", () => {
  it("adds missing targets and removes managed folders that stopped being targets", () => {
    const managed = new Set(["/repo/wt/old"]);
    const diff = computeSyncDiff(
      ["/repo/wt/a", "/repo/wt/kept"],
      ["/repo", "/repo/wt/kept"],
      managed,
    );
    expect(diff.toAdd).toEqual(["/repo/wt/a"]);
    expect(diff.toRemove).toEqual(["/repo/wt/old"]);
  });

  it("never removes folders that are not managed (user-added, main repo)", () => {
    const diff = computeSyncDiff([], ["/repo", "/user/dir"], new Set());
    expect(diff.toAdd).toEqual([]);
    expect(diff.toRemove).toEqual([]);
  });
});
