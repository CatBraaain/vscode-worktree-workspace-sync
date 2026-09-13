import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startExtension } from "../src/runtime";
import type { WorktreeEntry } from "../src/porcelain";
import { createFakeGit, FakeVscode, wt } from "./helpers/fake";

const MAIN = "/repo";
const FEAT = "/repo/.claude/worktrees/feat-x";
const mainEntry = wt(MAIN, { branch: "main" });
const featEntry = wt(FEAT, { branch: "feat-x" });

async function setup(
  folderPaths: string[],
  entries: readonly WorktreeEntry[] = [mainEntry, featEntry],
) {
  const api = new FakeVscode(folderPaths);
  // The repair tests control the repository open state manually.
  api.mirrorGitRepos = false;
  const git = createFakeGit(entries);
  await startExtension(api, git.exec);
  return api;
}

/** Leaves only the main repository open in the built-in git extension. */
function closeFeatRepository(api: FakeVscode): void {
  api.gitApi.closeAll();
  api.gitApi.openRepository(MAIN);
}

// SPEC ソースコントロール表示の修復: a synced worktree whose repository
// went missing from the built-in git extension gets repaired.
describe("scm repair", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("repairs a synced worktree missing from the source control after the 15s grace period, closing its tabs", async () => {
    const api = await setup([MAIN, FEAT]);
    closeFeatRepository(api);
    api.openTabs(`${FEAT}/src/a.ts`, `${MAIN}/README.md`);

    await vi.advanceTimersByTimeAsync(0);
    expect(api.removed).toEqual([]);

    await vi.advanceTimersByTimeAsync(15_000);
    expect(api.removed).toEqual([FEAT]);
    expect(api.added).toEqual([{ path: FEAT, name: "feat-x  ·  agent" }]);
    expect(api.closedTabs).toEqual([`${FEAT}/src/a.ts`]);
    expect(api.openTabPaths).toEqual([`${MAIN}/README.md`]);
    expect(api.folderPaths).toEqual([MAIN, FEAT]);
  });

  it("does not repair before the grace period elapses", async () => {
    const api = await setup([MAIN, FEAT]);
    closeFeatRepository(api);

    await vi.advanceTimersByTimeAsync(12_500);
    expect(api.removed).toEqual([]);
    expect(api.added).toEqual([]);
    expect(api.folderPaths).toEqual([MAIN, FEAT]);
  });

  it("repeats the repair while the repository stays missing", async () => {
    const api = await setup([MAIN, FEAT]);
    closeFeatRepository(api);

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(api.removed).toEqual([FEAT]);
    expect(api.added).toEqual([{ path: FEAT, name: "feat-x  ·  agent" }]);

    // The miss is re-detected after the repair, so the next attempt waits
    // another grace period (17.5s: first sighting at t=17.5s, repair at
    // t=32.5s — polling at 2.5s intervals).
    await vi.advanceTimersByTimeAsync(17_500);
    expect(api.removed).toEqual([FEAT, FEAT]);
    expect(api.added).toEqual([
      { path: FEAT, name: "feat-x  ·  agent" },
      { path: FEAT, name: "feat-x  ·  agent" },
    ]);
    expect(api.folderPaths).toEqual([MAIN, FEAT]);
  });

  // 判定対象はフォルダ0を除く: folder 0 is never touched (removing it
  // restarts the extension host).
  it("never repairs folder 0, even when its repository is missing", async () => {
    const api = await setup([MAIN, FEAT]);
    api.gitApi.closeAll();
    api.gitApi.openRepository(FEAT);

    await vi.advanceTimersByTimeAsync(15_000);
    expect(api.removed).toEqual([]);
    expect(api.added).toEqual([]);
    expect(api.folderPaths).toEqual([MAIN, FEAT]);
  });

  it("does not repair folders outside the sync scope", async () => {
    const api = await setup([MAIN, "/user/dir"], [mainEntry]);
    api.gitApi.closeAll();
    api.gitApi.openRepository(MAIN);

    await vi.advanceTimersByTimeAsync(15_000);
    expect(api.removed).toEqual([]);
    expect(api.added).toEqual([]);
    expect(api.folderPaths).toEqual([MAIN, "/user/dir"]);
  });

  it("does not repair when the built-in git extension API is unavailable", async () => {
    const api = await setup([MAIN, FEAT]);
    closeFeatRepository(api);
    api.gitExtensionInstalled = false;

    await vi.advanceTimersByTimeAsync(15_000);
    expect(api.removed).toEqual([]);
    expect(api.added).toEqual([]);
    expect(api.folderPaths).toEqual([MAIN, FEAT]);
  });

  // 1回のポーリングで修復するフォルダは1つ。再追加は一覧の末尾。
  it("repairs one missing folder per poll, re-adding it at the end of the list", async () => {
    const topic = wt("/repo/wt/topic", { branch: "topic" });
    const api = await setup([MAIN, "/repo/wt/topic", FEAT], [mainEntry, featEntry, topic]);
    api.gitApi.closeAll();
    api.gitApi.openRepository(MAIN);

    await vi.advanceTimersByTimeAsync(0);
    expect(api.folderPaths).toEqual([MAIN, "/repo/wt/topic", FEAT]);

    await vi.advanceTimersByTimeAsync(15_000);
    expect(api.removed).toEqual(["/repo/wt/topic"]);
    expect(api.added).toEqual([{ path: "/repo/wt/topic", name: "topic" }]);
    expect(api.folderPaths).toEqual([MAIN, FEAT, "/repo/wt/topic"]);

    // The next poll repairs the remaining missing folder.
    await vi.advanceTimersByTimeAsync(2_500);
    expect(api.removed).toEqual(["/repo/wt/topic", FEAT]);
    expect(api.added).toEqual([
      { path: "/repo/wt/topic", name: "topic" },
      { path: FEAT, name: "feat-x  ·  agent" },
    ]);
    expect(api.folderPaths).toEqual([MAIN, "/repo/wt/topic", FEAT]);
  });
});
