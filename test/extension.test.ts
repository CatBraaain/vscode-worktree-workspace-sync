/**
 * End-to-end wiring test for the real entry point (src/extension.ts):
 * the "vscode" module is replaced with a recording fake, while git runs
 * for real in a temporary repository, so activate() is verified from the
 * adapter down to the sync engine and the title bar write.
 */

import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const execFile = promisify(execFileCallback);

vi.mock("vscode", () => {
  interface FakeFolder {
    uri: { fsPath: string };
    name: string;
  }
  const state = {
    folders: [] as FakeFolder[],
    added: [] as { path: string; name: string | undefined }[],
    titleUpdates: [] as { section: string; key: string; value: unknown }[],
    listeners: new Set<() => void>(),
  };
  return {
    Uri: { file: (fsPath: string) => ({ fsPath }) },
    ConfigurationTarget: { Workspace: 2 },
    workspace: {
      get workspaceFolders() {
        return state.folders;
      },
      workspaceFile: undefined,
      getConfiguration: (section: string) => ({
        get: (_key: string, defaultValue: unknown) => defaultValue,
        update: (key: string, value: unknown) => {
          state.titleUpdates.push({ section, key, value });
          return Promise.resolve();
        },
      }),
      updateWorkspaceFolders: (
        start: number,
        deleteCount: number | undefined,
        ...toAdd: { uri: { fsPath: string }; name?: string }[]
      ) => {
        state.folders.splice(
          start,
          deleteCount ?? 0,
          ...toAdd.map((folder) => ({ uri: folder.uri, name: folder.name ?? folder.uri.fsPath })),
        );
        state.added.push(
          ...toAdd.map((folder) => ({ path: folder.uri.fsPath, name: folder.name })),
        );
        for (const listener of state.listeners) {
          listener();
        }
        return true;
      },
      onDidChangeWorkspaceFolders: (listener: () => void) => {
        state.listeners.add(listener);
        return { dispose: () => state.listeners.delete(listener) };
      },
    },
    window: {
      tabGroups: {
        all: [] as never[],
        close: () => Promise.resolve(true),
      },
    },
    __state: state,
  };
});

import * as vscode from "vscode";
import { activate } from "../src/extension";

type MockState = {
  folders: { uri: { fsPath: string }; name: string }[];
  added: { path: string; name: string | undefined }[];
  titleUpdates: { section: string; key: string; value: unknown }[];
  listeners: Set<() => void>;
};

function mockState(): MockState {
  return (vscode as unknown as { __state: MockState }).__state;
}

// SPEC 対象と適用範囲/起動 + タイトルバー + 同期の定義/変化表 行1,
// through the real activate() entry point.
describe("activate wiring", () => {
  let tmp: string;
  let repo: string;
  let worktree: string;
  let subscriptions: { dispose(): void }[];

  beforeEach(async () => {
    const state = mockState();
    state.folders.length = 0;
    state.added.length = 0;
    state.titleUpdates.length = 0;
    state.listeners.clear();

    tmp = await mkdtemp(path.join(tmpdir(), "wtas-"));
    repo = path.join(tmp, "main");
    worktree = path.join(tmp, "feat-x");
    await execFile("git", ["init", "-q", repo]);
    await execFile("git", ["-C", repo, "config", "user.email", "test@example.com"]);
    await execFile("git", ["-C", repo, "config", "user.name", "test"]);
    await execFile("git", ["-C", repo, "commit", "--allow-empty", "-q", "-m", "init"]);
    await execFile("git", ["-C", repo, "worktree", "add", "-q", "-b", "feat-x", worktree]);
  });

  afterEach(async () => {
    for (const disposable of subscriptions) {
      disposable.dispose();
    }
    await rm(tmp, { recursive: true, force: true });
  });

  it("starts the sync engine and applies the untitled-workspace title", async () => {
    const state = mockState();
    state.folders.push({ uri: { fsPath: repo }, name: path.basename(repo) });
    subscriptions = [];

    activate({ subscriptions } as unknown as vscode.ExtensionContext);

    await vi.waitFor(() => expect(state.added).toHaveLength(1));
    expect(state.added[0]).toEqual({ path: worktree, name: "feat-x" });
    expect(state.folders.map((folder) => folder.uri.fsPath)).toEqual([repo, worktree]);
    expect(state.titleUpdates).toEqual([
      {
        section: "window",
        key: "title",
        value:
          "${dirty}${activeEditorShort}${separator}" +
          path.basename(repo) +
          "${separator}${profileName}${separator}${appName}",
      },
    ]);
  });
});
