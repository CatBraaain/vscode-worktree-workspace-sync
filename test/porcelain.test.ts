import { describe, expect, it } from "vitest";
import { parseWorktreePorcelain } from "../src/porcelain";

// SPEC 同期の定義: the worktree list is read from
// `git worktree list --porcelain`, so the parser must handle every entry
// kind real git emits (branch, detached, bare, locked, prunable).
const FIXTURE = [
  "worktree /repo",
  "HEAD 1111111111111111111111111111111111111111",
  "branch refs/heads/main",
  "",
  "worktree /repo/.claude/worktrees/agent",
  "HEAD 2222222222222222222222222222222222222222",
  "branch refs/heads/feat/nested",
  "",
  "worktree /repo/det",
  "HEAD 3333333333333333333333333333333333333333",
  "detached",
  "",
  "worktree /repo.git",
  "bare",
  "",
  "worktree /repo/gone",
  "HEAD 4444444444444444444444444444444444444444",
  "branch refs/heads/gone",
  "prunable working tree is missing",
  "",
  "worktree /repo/locked",
  "HEAD 5555555555555555555555555555555555555555",
  "branch refs/heads/locked",
  "locked some reason",
].join("\n");

describe("parseWorktreePorcelain", () => {
  it("parses every entry kind, skipping bare repositories", () => {
    const entries = parseWorktreePorcelain(FIXTURE);
    expect(entries).toHaveLength(5);

    expect(entries[0]).toEqual({
      path: "/repo",
      head: "1111111111111111111111111111111111111111",
      branch: "main",
      prunable: false,
    });
    expect(entries[1]).toEqual({
      path: "/repo/.claude/worktrees/agent",
      head: "2222222222222222222222222222222222222222",
      branch: "feat/nested",
      prunable: false,
    });
    // No branch means detached; the "detached" marker itself is ignored.
    expect(entries[2]).toEqual({
      path: "/repo/det",
      head: "3333333333333333333333333333333333333333",
      branch: null,
      prunable: false,
    });
    // The prunable reason text is not part of the parsed entry.
    expect(entries[3]).toEqual({
      path: "/repo/gone",
      head: "4444444444444444444444444444444444444444",
      branch: "gone",
      prunable: true,
    });
    // The "locked" marker is ignored: a locked worktree stays a regular
    // (living) entry.
    expect(entries[4]).toEqual({
      path: "/repo/locked",
      head: "5555555555555555555555555555555555555555",
      branch: "locked",
      prunable: false,
    });
  });

  it("skips blocks without a worktree path or a HEAD line", () => {
    expect(
      parseWorktreePorcelain(
        ["worktree /no-head", "", "HEAD 1111111111111111111111111111111111111111"].join("\n"),
      ),
    ).toEqual([]);
  });

  it("parses CRLF output", () => {
    const entries = parseWorktreePorcelain(FIXTURE.replace(/\n/g, "\r\n"));
    expect(entries).toHaveLength(5);
    expect(entries[1].branch).toBe("feat/nested");
  });

  it("ignores a trailing newline and accepts empty input", () => {
    expect(parseWorktreePorcelain(`${FIXTURE}\n`)).toHaveLength(5);
    expect(parseWorktreePorcelain("")).toEqual([]);
  });
});
