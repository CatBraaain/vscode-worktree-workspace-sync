/**
 * SPEC 起動時のワークスペース遷移: a single-folder window without a
 * saved workspace file is transitioned to an untitled workspace at
 * startup by re-applying folder 0 unchanged.
 */

import { describe, expect, it } from "vitest";
import { promoteToUntitledWorkspace } from "../src/promote";
import { FakeVscode, savedWorkspace } from "./helpers/fake";

const MAIN = "/repo";

describe("promoteToUntitledWorkspace", () => {
  it("re-applies folder 0 unchanged for a single folder without a saved workspace file", async () => {
    const api = new FakeVscode([MAIN]);
    await promoteToUntitledWorkspace(api);
    expect(api.added).toEqual([{ path: MAIN, name: "repo" }]);
    expect(api.removed).toEqual([MAIN]);
    expect(api.folderPaths).toEqual([MAIN]);
    expect(api.workspace.workspaceFolders[0].name).toBe("repo");
  });

  it("does nothing for a saved workspace file", async () => {
    const api = new FakeVscode([MAIN], savedWorkspace("/somewhere/main.code-workspace"));
    await promoteToUntitledWorkspace(api);
    expect(api.added).toEqual([]);
  });

  it("does nothing with two or more workspace folders", async () => {
    const api = new FakeVscode([MAIN, "/user/dir"]);
    await promoteToUntitledWorkspace(api);
    expect(api.added).toEqual([]);
  });

  it("does nothing without workspace folders", async () => {
    for (const folders of [undefined, []]) {
      const api = new FakeVscode(folders);
      await promoteToUntitledWorkspace(api);
      expect(api.added).toEqual([]);
    }
  });

  it("does nothing while sync is disabled", async () => {
    const api = new FakeVscode([MAIN]);
    api.config.worktreeWorkspaceSync = { enabled: false };
    await promoteToUntitledWorkspace(api);
    expect(api.added).toEqual([]);
  });

  // SPEC 起動時のワークスペース遷移 (遷移に失敗したときは何もせず通知もしない)。
  it("keeps folder 0 untouched when the transition update is rejected", async () => {
    const api = new FakeVscode([MAIN]);
    api.failNextUpdate = true;
    await expect(promoteToUntitledWorkspace(api)).resolves.toBeUndefined();
    expect(api.added).toEqual([]);
    expect(api.folderPaths).toEqual([MAIN]);
  });
});
