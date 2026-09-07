import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startExtension } from "../src/runtime";
import type { WorktreeEntry } from "../src/porcelain";
import { createFakeGit, FakeVscode, wt } from "./helpers/fake";

const MAIN = "/repo";
const FEAT = "/repo/.claude/worktrees/feat-x";
const mainEntry = wt(MAIN, { branch: "main" });
const featEntry = wt(FEAT, { branch: "feat-x" });

async function setup(
  folderPaths: string[] | undefined,
  entries: readonly WorktreeEntry[],
  config: Record<string, unknown> = {},
) {
  const api = new FakeVscode(folderPaths);
  api.config.worktreeWorkspaceSync = { ...config };
  const git = createFakeGit(entries);
  const handle = await startExtension(api, git.exec);
  return { api, git, handle };
}

// SPEC 対象と適用範囲/起動: the extension only operates when at least one
// workspace folder is open.
describe("activation gate", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("does nothing without workspace folders", async () => {
    for (const folders of [undefined, []]) {
      const { api, git } = await setup(folders, [mainEntry, featEntry]);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(git.calls).toHaveLength(0);
      expect(api.added).toEqual([]);
      expect(api.titleUpdates).toEqual([]);
    }
  });
});

// SPEC 対象と適用範囲/主リポジトリ: workspace folder 0 is the main
// repository, regardless of how many folders are open.
describe("main repository selection", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("always polls git in workspace folder 0", async () => {
    const { api, git } = await setup([MAIN, "/user/dir"], [mainEntry, featEntry]);
    await vi.advanceTimersByTimeAsync(0);
    expect(api.added).toEqual([{ path: FEAT, name: "feat-x  ·  agent" }]);

    await vi.advanceTimersByTimeAsync(2500);
    expect(git.calls.length).toBeGreaterThanOrEqual(2);
    expect(git.calls.map((call) => call.cwd)).toEqual(git.calls.map(() => MAIN));
  });
});

// SPEC 設定/enabled: only syncs while enabled.
describe("enabled setting", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not sync while disabled, then syncs once enabled", async () => {
    const { api, git } = await setup([MAIN], [mainEntry, featEntry], {
      enabled: false,
    });

    await vi.advanceTimersByTimeAsync(10_000);
    expect(git.calls).toHaveLength(0);
    expect(api.added).toEqual([]);

    api.config.worktreeWorkspaceSync.enabled = true;
    await vi.advanceTimersByTimeAsync(2500);
    expect(git.calls).toHaveLength(1);
    expect(api.added).toEqual([{ path: FEAT, name: "feat-x  ·  agent" }]);
  });
});

// SPEC 設定 (設定変更は次のポーリングから反映): roots changes.
describe("configuration reload", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("applies a roots change from the next poll on", async () => {
    const plain = wt("/repo/wt/plain", { branch: "plain" });
    const { api, git } = await setup([MAIN], [mainEntry, featEntry, plain], {
      roots: ["/repo/wt"],
    });

    await vi.advanceTimersByTimeAsync(0);
    // The first added entry is the startup transition re-applying folder 0.
    expect(api.added).toEqual([
      { path: MAIN, name: "repo" },
      { path: "/repo/wt/plain", name: "plain" },
    ]);

    // Loosen the restriction: the remaining worktree is added on the next
    // poll, the already-added folder is kept.
    api.config.worktreeWorkspaceSync.roots = [];
    await vi.advanceTimersByTimeAsync(2500);
    expect(api.added).toEqual([
      { path: MAIN, name: "repo" },
      { path: "/repo/wt/plain", name: "plain" },
      { path: FEAT, name: "feat-x  ·  agent" },
    ]);

    // Tighten the restriction again: the out-of-roots folder is removed.
    api.config.worktreeWorkspaceSync.roots = ["/repo/wt"];
    await vi.advanceTimersByTimeAsync(2500);
    // MAIN in removed[0] is the startup transition re-applying folder 0.
    expect(api.removed).toEqual([MAIN, FEAT]);
    expect(api.folderPaths).toEqual([MAIN, "/repo/wt/plain"]);
    expect(git.calls.length).toBeGreaterThan(1);
  });
});

// SPEC 同期の定義/変化表 行1: additions with folder names.
describe("worktree addition", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("adds missing worktrees as named folders via git worktree list", async () => {
    const entries = [
      mainEntry,
      wt("/repo/wt/topic", { branch: "topic" }),
      wt("/repo/wt/det", { head: "abcdef1234567890" }),
      featEntry,
    ];
    const { api, git } = await setup([MAIN], entries);

    await vi.advanceTimersByTimeAsync(0);
    expect(api.added).toEqual([
      { path: MAIN, name: "repo" },
      { path: "/repo/wt/topic", name: "topic" },
      { path: "/repo/wt/det", name: "(detached abcdef1)" },
      { path: FEAT, name: "feat-x  ·  agent" },
    ]);
    expect(api.folderPaths).toEqual([MAIN, "/repo/wt/topic", "/repo/wt/det", FEAT]);
    expect(git.calls[0].args).toEqual(["worktree", "list", "--porcelain"]);
    expect(git.calls[0].cwd).toBe(MAIN);
  });
});

// SPEC 同期の定義/変化表 行2: removals when a worktree disappears or
// leaves the target set.
describe("worktree removal", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("removes the folder when the worktree disappears from the list, closing tabs under it", async () => {
    const { api, git } = await setup([MAIN], [mainEntry, featEntry]);
    api.openTabs(`${FEAT}/src/a.ts`, `${MAIN}/README.md`);
    await vi.advanceTimersByTimeAsync(0);
    expect(api.folderPaths).toEqual([MAIN, FEAT]);

    git.setEntries([mainEntry]);
    await vi.advanceTimersByTimeAsync(2500);

    // MAIN in removed[0] is the startup transition re-applying folder 0.
    expect(api.removed).toEqual([MAIN, FEAT]);
    expect(api.closedTabs).toEqual([`${FEAT}/src/a.ts`]);
    expect(api.openTabPaths).toEqual([`${MAIN}/README.md`]);
    expect(api.folderPaths).toEqual([MAIN]);
  });

  it("removes the folder when the worktree entry becomes prunable", async () => {
    const { api, git } = await setup([MAIN], [mainEntry, featEntry]);
    await vi.advanceTimersByTimeAsync(0);

    git.setEntries([
      mainEntry,
      wt(FEAT, {
        branch: "feat-x",
        prunable: true,
      }),
    ]);
    await vi.advanceTimersByTimeAsync(2500);

    expect(api.removed).toEqual([MAIN, FEAT]);
    expect(api.folderPaths).toEqual([MAIN]);
  });

  it("removes the folder when roots filtering makes the worktree a non-target", async () => {
    const { api } = await setup([MAIN], [mainEntry, featEntry]);
    await vi.advanceTimersByTimeAsync(0);
    expect(api.folderPaths).toEqual([MAIN, FEAT]);

    api.config.worktreeWorkspaceSync.roots = ["/nowhere"];
    await vi.advanceTimersByTimeAsync(2500);

    expect(api.removed).toEqual([MAIN, FEAT]);
    expect(api.folderPaths).toEqual([MAIN]);
  });
});

// SPEC 同期の定義/変化表 行3: folders outside the sync scope stay
// untouched.
describe("unmanaged folders", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps user-added folders and the main repository folder", async () => {
    const { api, git } = await setup([MAIN, "/user/dir"], [mainEntry, featEntry]);

    await vi.advanceTimersByTimeAsync(0);
    expect(api.folderPaths).toEqual([MAIN, "/user/dir", FEAT]);

    git.setEntries([mainEntry]);
    await vi.advanceTimersByTimeAsync(2500);

    expect(api.removed).toEqual([FEAT]);
    expect(api.folderPaths).toEqual([MAIN, "/user/dir"]);
  });
});

// SPEC 同期の定義/変化表 行1 (存在し、ワークスペースにまだ無い): drift repair.
describe("drift repair", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("re-adds a folder the user removed while the worktree still lives", async () => {
    const { api, git } = await setup([MAIN], [mainEntry, featEntry]);
    await vi.advanceTimersByTimeAsync(0);
    expect(api.folderPaths).toEqual([MAIN, FEAT]);

    // The user removes the synced folder from the workspace.
    api.workspace.updateWorkspaceFolders(1, 1);
    expect(api.folderPaths).toEqual([MAIN]);

    await vi.advanceTimersByTimeAsync(2500);
    expect(api.folderPaths).toEqual([MAIN, FEAT]);
    // The first added entry is the startup transition re-applying folder 0.
    expect(api.added).toEqual([
      { path: MAIN, name: "repo" },
      { path: FEAT, name: "feat-x  ·  agent" },
      { path: FEAT, name: "feat-x  ·  agent" },
    ]);
    expect(git.calls.length).toBeGreaterThanOrEqual(2);
  });
});

// SPEC 同期の定義 (失敗時は同期状態を変えず次のポーリングで再試行)。
describe("failure handling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("retries on the next poll when reading the worktree list fails", async () => {
    const { api, git } = await setup([MAIN], [mainEntry, featEntry]);
    git.failOnce();

    await vi.advanceTimersByTimeAsync(0);
    // The added entry is the startup transition re-applying folder 0.
    expect(api.folderPaths).toEqual([MAIN]);
    expect(api.added).toEqual([{ path: MAIN, name: "repo" }]);

    await vi.advanceTimersByTimeAsync(2500);
    expect(api.added).toEqual([
      { path: MAIN, name: "repo" },
      { path: FEAT, name: "feat-x  ·  agent" },
    ]);
    expect(api.folderPaths).toEqual([MAIN, FEAT]);
  });

  it("retries a rejected folder removal on the next poll", async () => {
    const { api, git } = await setup([MAIN], [mainEntry, featEntry]);
    await vi.advanceTimersByTimeAsync(0);
    expect(api.folderPaths).toEqual([MAIN, FEAT]);

    git.setEntries([mainEntry]);
    api.failNextUpdate = true;
    await vi.advanceTimersByTimeAsync(2500);
    expect(api.folderPaths).toEqual([MAIN, FEAT]);

    await vi.advanceTimersByTimeAsync(2500);
    // MAIN in removed[0] is the startup transition re-applying folder 0.
    expect(api.removed).toEqual([MAIN, FEAT]);
    expect(api.folderPaths).toEqual([MAIN]);
  });

  // SPEC 起動時のワークスペース遷移 (遷移に失敗したときは、何もせず通知もしない。同期は次のポーリングで通常どおり動く)。
  it("keeps folder 0 and syncs on the next poll after a rejected startup transition", async () => {
    const api = new FakeVscode([MAIN]);
    api.config.worktreeWorkspaceSync = {};
    const git = createFakeGit([mainEntry, featEntry]);
    api.failNextUpdate = true;
    await startExtension(api, git.exec);

    await vi.advanceTimersByTimeAsync(0);
    // The transition was rejected (folder 0 was not re-applied), but the
    // poll still added the worktree: sync keeps working.
    expect(api.added).toEqual([{ path: FEAT, name: "feat-x  ·  agent" }]);
    expect(api.folderPaths).toEqual([MAIN, FEAT]);

    await vi.advanceTimersByTimeAsync(2500);
    expect(git.calls).toHaveLength(2);
    expect(api.folderPaths).toEqual([MAIN, FEAT]);
  });
});

// SPEC 起動時のワークスペース遷移 (準備待ちの間、同期 (ポーリング) は開始しない)。
describe("polling start after readiness wait", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts polling only after the folder-0 repository is discovered", async () => {
    const api = new FakeVscode([MAIN]);
    api.config.worktreeWorkspaceSync = {};
    const git = createFakeGit([mainEntry, featEntry]);
    api.gitApi.closeAll();

    void startExtension(api, git.exec);
    await vi.advanceTimersByTimeAsync(2900);
    expect(git.calls).toHaveLength(0);

    api.gitApi.openRepository(MAIN);
    await vi.advanceTimersByTimeAsync(0);
    expect(git.calls).toHaveLength(1);
    expect(api.folderPaths).toEqual([MAIN, FEAT]);
  });

  it("starts polling when the readiness wait reaches the 3s cap", async () => {
    const api = new FakeVscode([MAIN]);
    api.config.worktreeWorkspaceSync = {};
    const git = createFakeGit([mainEntry, featEntry]);
    api.gitApi.closeAll();

    void startExtension(api, git.exec);
    await vi.advanceTimersByTimeAsync(2900);
    expect(git.calls).toHaveLength(0);

    // The cap timer fires at 3s; the extra headroom absorbs timer/microtask
    // scheduling jitter under fake timers.
    await vi.advanceTimersByTimeAsync(200);
    expect(git.calls).toHaveLength(1);
    expect(api.added).toEqual([
      { path: MAIN, name: "repo" },
      { path: FEAT, name: "feat-x  ·  agent" },
    ]);
  });
});
