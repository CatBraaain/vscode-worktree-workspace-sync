/**
 * Polling sync engine. Each tick re-reads the configuration, runs
 * `git worktree list --porcelain` fresh, and applies the diff between the
 * sync targets and the workspace folders via updateWorkspaceFolders.
 */

import path from "node:path";
import type { VscodeLike } from "./api";
import {
  computeSyncDiff,
  effectivePollIntervalMs,
  filterTargetEntries,
  folderNameFor,
  isUnderOrEqual,
} from "./core";
import { listWorktrees, type ExecFile, type WorktreeEntry } from "./porcelain";

interface SyncSettings {
  enabled: boolean;
  pollIntervalMs: number;
  roots: string[];
}

export interface EngineDeps {
  readonly vscode: VscodeLike;
  readonly mainRepoPath: string;
  readonly execFile: ExecFile;
}

const APPLY_TIMEOUT_MS = 3000;

export class AutoSyncEngine {
  private readonly deps: EngineDeps;
  /** Folder paths this extension added or adopted as sync targets. */
  private readonly managed = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running = false;
  private busy = false;

  constructor(deps: EngineDeps) {
    this.deps = deps;
  }

  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    this.schedule(0);
  }

  stop(): void {
    this.running = false;
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  private schedule(delayMs: number): void {
    this.timer = setTimeout(() => {
      void this.tick();
    }, delayMs);
  }

  private readSettings(): SyncSettings {
    const config = this.deps.vscode.workspace.getConfiguration("worktreeWorkspaceSync");
    return {
      enabled: config.get("enabled", true),
      pollIntervalMs: effectivePollIntervalMs(config.get("pollIntervalMs", 2500)),
      roots: config.get("roots", []),
    };
  }

  private async tick(): Promise<void> {
    this.timer = undefined;
    if (!this.running) {
      return;
    }
    if (this.busy) {
      this.schedule(this.readSettings().pollIntervalMs);
      return;
    }
    this.busy = true;
    const settings = this.readSettings();
    try {
      if (settings.enabled) {
        await this.syncOnce(settings.roots);
      }
    } catch {
      // A failed poll (e.g. git error) is retried on the next tick.
    } finally {
      this.busy = false;
      if (this.running) {
        this.schedule(settings.pollIntervalMs);
      }
    }
  }

  private async syncOnce(roots: readonly string[]): Promise<void> {
    const entries = await listWorktrees(this.deps.mainRepoPath, this.deps.execFile);
    const targetEntries = filterTargetEntries(entries, this.deps.mainRepoPath, roots);
    const targetPaths = targetEntries.map((entry) => path.resolve(entry.path));
    const targetSet = new Set(targetPaths);

    const folderPaths = (this.deps.vscode.workspace.workspaceFolders ?? []).map((folder) =>
      path.resolve(folder.uri.fsPath),
    );
    // Adopt workspace folders (other than folder 0) that are current
    // targets, so a restart or a user re-add keeps them managed.
    for (let i = 1; i < folderPaths.length; i++) {
      if (targetSet.has(folderPaths[i])) {
        this.managed.add(folderPaths[i]);
      }
    }

    const { toAdd, toRemove } = computeSyncDiff(targetPaths, folderPaths, this.managed);
    if (toAdd.length === 0 && toRemove.length === 0) {
      return;
    }
    const addSet = new Set(toAdd);
    const additions = targetEntries.filter((entry) => addSet.has(path.resolve(entry.path)));
    await this.applyRemovals(toRemove);
    await this.applyAdditions(additions);
  }

  private async applyRemovals(removals: readonly string[]): Promise<void> {
    for (const folderPath of removals) {
      const index = this.indexOfFolder(folderPath);
      // Not present anymore, or folder 0 (never touched by this extension).
      if (index <= 0) {
        this.managed.delete(folderPath);
        continue;
      }
      await this.closeTabsUnder(folderPath);
      await this.updateFoldersAndWait(index, 1);
      if (this.indexOfFolder(folderPath) === -1) {
        this.managed.delete(folderPath);
      }
      // Otherwise the removal was rejected: keep the folder managed so
      // the next poll retries it (spec: failures retry on the next poll).
    }
  }

  private async applyAdditions(additions: readonly WorktreeEntry[]): Promise<void> {
    if (additions.length === 0) {
      return;
    }
    const start = this.deps.vscode.workspace.workspaceFolders?.length ?? 0;
    const folders = additions.map((entry) => ({
      uri: { fsPath: path.resolve(entry.path) },
      name: folderNameFor(entry),
    }));
    for (const entry of additions) {
      this.managed.add(path.resolve(entry.path));
    }
    await this.updateFoldersAndWait(start, 0, ...folders);
  }

  private indexOfFolder(folderPath: string): number {
    const folders = this.deps.vscode.workspace.workspaceFolders ?? [];
    return folders.findIndex((folder) => path.resolve(folder.uri.fsPath) === folderPath);
  }

  private async closeTabsUnder(folderPath: string): Promise<void> {
    const tabsToClose = [];
    for (const group of this.deps.vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        const input = tab.input;
        const uri = input?.uri ?? input?.modified;
        if (uri && isUnderOrEqual(path.resolve(uri.fsPath), folderPath)) {
          tabsToClose.push(tab);
        }
      }
    }
    if (tabsToClose.length > 0) {
      await this.deps.vscode.window.tabGroups.close(tabsToClose, true);
    }
  }

  /**
   * updateWorkspaceFolders is asynchronous: the workspace folders list is
   * updated only after onDidChangeWorkspaceFolders fires. Wait for that
   * event (with a timeout fallback) so consecutive edits see fresh
   * indices.
   */
  private updateFoldersAndWait(
    start: number,
    deleteCount: number | undefined,
    ...folders: ReadonlyArray<{ uri: { fsPath: string }; name?: string }>
  ): Promise<void> {
    return new Promise((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) {
          return;
        }
        settled = true;
        subscription.dispose();
        clearTimeout(fallback);
        resolve();
      };
      const subscription = this.deps.vscode.workspace.onDidChangeWorkspaceFolders(done);
      const fallback = setTimeout(done, APPLY_TIMEOUT_MS);
      const accepted = this.deps.vscode.workspace.updateWorkspaceFolders(
        start,
        deleteCount,
        ...folders,
      );
      if (!accepted) {
        done();
      }
    });
  }
}
