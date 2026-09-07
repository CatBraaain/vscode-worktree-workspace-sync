/**
 * SPEC 起動時のワークスペース遷移 (準備待ち): the transition waits for
 * GitLens activation and built-in git repository discovery, capped at 3
 * seconds in total.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promoteToUntitledWorkspace } from "../src/promote";
import { FakeExtension, FakeVscode } from "./helpers/fake";

const MAIN = "/repo";

describe("transition readiness", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("waits for a pending GitLens activation before transitioning", async () => {
    const api = new FakeVscode([MAIN]);
    api.gitlens = new FakeExtension({});
    let releaseActivation!: () => void;
    api.gitlens.activateGate = new Promise<void>((resolve) => (releaseActivation = resolve));

    const transition = promoteToUntitledWorkspace(api);
    await vi.advanceTimersByTimeAsync(1000);
    expect(api.added).toEqual([]);

    releaseActivation();
    await transition;
    expect(api.added).toEqual([{ path: MAIN, name: "repo" }]);
  });

  // SPEC (VS Code 内蔵の Git 機能がワークスペースフォルダ0に対応する
  // リポジトリを認識していること。認識していない場合は認識するまで待つ)。
  it("waits for the built-in git extension to open the folder-0 repository", async () => {
    const api = new FakeVscode([MAIN]);
    api.gitApi.closeAll();

    const transition = promoteToUntitledWorkspace(api);
    await vi.advanceTimersByTimeAsync(1000);
    expect(api.added).toEqual([]);

    api.gitApi.openRepository(MAIN);
    await transition;
    expect(api.added).toEqual([{ path: MAIN, name: "repo" }]);
  });

  // SPEC (対応とは、リポジトリのルートがフォルダ0と一致するか、いずれかが
  // 他方の配下にあること)。
  it("recognizes a repository in a parent folder as covering folder 0", async () => {
    const api = new FakeVscode(["/repo/sub"]);
    api.gitApi.closeAll();
    api.gitApi.openRepository("/repo");

    await promoteToUntitledWorkspace(api);
    expect(api.added).toEqual([{ path: "/repo/sub", name: "sub" }]);
  });

  it("recognizes a repository under folder 0 as covering it", async () => {
    const api = new FakeVscode([MAIN]);
    api.gitApi.closeAll();
    api.gitApi.openRepository(`${MAIN}/wt/feat`);

    await promoteToUntitledWorkspace(api);
    expect(api.added).toEqual([{ path: MAIN, name: "repo" }]);
  });

  it("ends the repository wait when a covering repository opens mid-wait", async () => {
    const api = new FakeVscode(["/repo/sub"]);
    api.gitApi.closeAll();

    const transition = promoteToUntitledWorkspace(api);
    await vi.advanceTimersByTimeAsync(1000);
    expect(api.added).toEqual([]);

    api.gitApi.openRepository("/repo");
    await transition;
    expect(api.added).toEqual([{ path: "/repo/sub", name: "sub" }]);
  });

  it("ends the repository wait when a repository under folder 0 opens mid-wait", async () => {
    const api = new FakeVscode([MAIN]);
    api.gitApi.closeAll();

    const transition = promoteToUntitledWorkspace(api);
    await vi.advanceTimersByTimeAsync(1000);
    expect(api.added).toEqual([]);

    api.gitApi.openRepository(`${MAIN}/wt/feat`);
    await transition;
    expect(api.added).toEqual([{ path: MAIN, name: "repo" }]);
  });

  it("keeps waiting while only non-covering repositories are open", async () => {
    const api = new FakeVscode([MAIN]);
    api.gitApi.closeAll();
    api.gitApi.openRepository("/elsewhere");

    const transition = promoteToUntitledWorkspace(api);
    await vi.advanceTimersByTimeAsync(1000);
    expect(api.added).toEqual([]);

    api.gitApi.openRepository("/another-elsewhere");
    await vi.advanceTimersByTimeAsync(1000);
    expect(api.added).toEqual([]);

    api.gitApi.openRepository(MAIN);
    await transition;
    expect(api.added).toEqual([{ path: MAIN, name: "repo" }]);
  });

  // SPEC (準備待ちの合計が上限 (3秒) に達したときは待ちを打ち切り、その時点で遷移する)。
  it("transitions when the readiness wait reaches the 3s cap", async () => {
    const api = new FakeVscode([MAIN]);
    api.gitApi.closeAll();
    api.gitlens = new FakeExtension({});
    api.gitlens.activateGate = new Promise<void>(() => {});

    const transition = promoteToUntitledWorkspace(api);
    await vi.advanceTimersByTimeAsync(2900);
    expect(api.added).toEqual([]);

    // The cap timer fires at 3s; the extra headroom absorbs timer/microtask
    // scheduling jitter under fake timers.
    await vi.advanceTimersByTimeAsync(200);
    await transition;
    expect(api.added).toEqual([{ path: MAIN, name: "repo" }]);
  });

  // SPEC (GitLens 拡張の起動に失敗した場合も待ちを続け、残る準備が揃えば遷移する)。
  it("keeps waiting for the repository after GitLens activation rejects", async () => {
    const api = new FakeVscode([MAIN]);
    api.gitApi.closeAll();
    api.gitlens = new FakeExtension({}, { rejectActivation: true });

    const transition = promoteToUntitledWorkspace(api);
    await vi.advanceTimersByTimeAsync(1000);
    expect(api.added).toEqual([]);

    api.gitApi.openRepository(MAIN);
    await transition;
    expect(api.added).toEqual([{ path: MAIN, name: "repo" }]);
  });

  it("transitions without waiting when GitLens is already active", async () => {
    const api = new FakeVscode([MAIN]);
    api.gitlens = new FakeExtension({});
    api.gitlens.isActive = true;

    await promoteToUntitledWorkspace(api);
    expect(api.added).toEqual([{ path: MAIN, name: "repo" }]);
  });

  // SPEC (ワークスペースフォルダが2つ以上の場合は遷移しない): also when the
  // second folder appears during the readiness wait.
  it("does not transition when another folder appears during the wait", async () => {
    const api = new FakeVscode([MAIN]);
    api.gitApi.closeAll();

    const transition = promoteToUntitledWorkspace(api);
    await vi.advanceTimersByTimeAsync(1000);
    api.workspace.updateWorkspaceFolders(1, 0, { uri: { fsPath: "/user/dir" }, name: "dir" });

    api.gitApi.openRepository(MAIN);
    await transition;
    expect(api.added.some((folder) => folder.path === MAIN)).toBe(false);
  });
});
