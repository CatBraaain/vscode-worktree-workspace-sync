import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startExtension } from "../src/runtime";
import { WORKSPACE_TARGET, createFakeGit, FakeVscode, wt } from "./helpers/fake";

const MAIN = "/home/user/myrepo";
const FEAT = "/home/user/myrepo/.claude/worktrees/feat-x";

// SPEC タイトルバー: title bar behavior.
describe("title bar", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("writes the folder-0 name to window.title at workspace scope when untitled", async () => {
    const api = new FakeVscode([MAIN]);
    api.config.worktreeWorkspaceSync = {};
    await startExtension(api, createFakeGit([wt(MAIN, { branch: "main" })]).exec);

    await vi.advanceTimersByTimeAsync(0);
    expect(api.titleUpdates).toEqual([
      {
        section: "window",
        key: "title",
        value:
          "${dirty}${activeEditorShort}${separator}myrepo${separator}${profileName}${separator}${appName}",
        target: WORKSPACE_TARGET,
      },
    ]);

    // Written once at activation; polling does not rewrite it.
    await vi.advanceTimersByTimeAsync(2500);
    expect(api.titleUpdates).toHaveLength(1);
  });

  it("does not write window.title for a saved workspace file", async () => {
    const api = new FakeVscode([MAIN], `${MAIN}/my.code-workspace`);
    api.config.worktreeWorkspaceSync = {};
    await startExtension(api, createFakeGit([wt(MAIN, { branch: "main" })]).exec);

    await vi.advanceTimersByTimeAsync(2500);
    expect(api.titleUpdates).toEqual([]);
  });

  // SPEC タイトルバー (書き込み失敗時は何もせず通知もしない)。
  it("ignores a failed title write and keeps syncing", async () => {
    const api = new FakeVscode([MAIN]);
    api.config.worktreeWorkspaceSync = {};
    api.failTitleUpdate = true;
    const git = createFakeGit([wt(MAIN, { branch: "main" }), wt(FEAT, { branch: "feat-x" })]);
    await startExtension(api, git.exec);

    await vi.advanceTimersByTimeAsync(0);
    expect(api.titleUpdates).toHaveLength(1);
    // added[0] is the startup transition re-applying folder 0.
    expect(api.added).toEqual([
      { path: MAIN, name: "myrepo" },
      { path: FEAT, name: "feat-x  ·  agent" },
    ]);
  });
});
