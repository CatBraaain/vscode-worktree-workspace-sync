/**
 * Test doubles: a vscode-shaped fake that records workspace-folder and
 * tab operations, and an injectable git runner serving porcelain output.
 */

import path from "node:path";
import type {
  ConfigurationLike,
  DisposableLike,
  ExtensionLike,
  GitApiLike,
  GitExtensionExportsLike,
  GitRepositoryLike,
  TabLike,
  UriLike,
  VscodeLike,
  WorkspaceFolderLike,
} from "../../src/api";
import type { ExecFile, WorktreeEntry } from "../../src/porcelain";

// Mirrors the numeric value of vscode.ConfigurationTarget.Workspace.
export const WORKSPACE_TARGET = 2;

/** A workspaceFile URI as VS Code reports it for an untitled workspace. */
export function untitledWorkspace(): UriLike {
  return { scheme: "untitled", fsPath: "/1555503116870" };
}

/** A workspaceFile URI as VS Code reports it for a saved workspace file. */
export function savedWorkspace(fsPath: string): UriLike {
  return { scheme: "file", fsPath };
}

interface FakeTab extends TabLike {
  readonly uriPath: string;
}

export class FakeExtension<TExports> implements ExtensionLike<TExports> {
  isActive = false;
  activateCalls = 0;
  /** When set, activate() settles only after this promise does. */
  activateGate: PromiseLike<void> | undefined;

  constructor(
    readonly exports: TExports,
    private readonly options: { rejectActivation?: boolean } = {},
  ) {}

  activate(): PromiseLike<TExports> {
    this.activateCalls++;
    return (this.activateGate ? Promise.resolve(this.activateGate) : Promise.resolve()).then(() => {
      if (this.options.rejectActivation) {
        throw new Error("extension activation failed");
      }
      this.isActive = true;
      return this.exports;
    });
  }
}

export class FakeGitApi implements GitApiLike {
  readonly repositories: GitRepositoryLike[] = [];
  private readonly openListeners = new Set<(repository: GitRepositoryLike) => void>();

  onDidOpenRepository(listener: (repository: GitRepositoryLike) => void): DisposableLike {
    this.openListeners.add(listener);
    return { dispose: () => this.openListeners.delete(listener) };
  }

  openRepository(fsPath: string): void {
    // Mirrors the built-in git extension: an already-open root is a no-op.
    if (this.repositories.some((repository) => repository.root.fsPath === fsPath)) {
      return;
    }
    const repository: GitRepositoryLike = { root: { scheme: "file", fsPath } };
    this.repositories.push(repository);
    // Iterating the Set directly is safe against removals mid-loop.
    for (const listener of this.openListeners) {
      listener(repository);
    }
  }

  closeAll(): void {
    this.repositories.length = 0;
  }
}

// Like VscodeLike["workspace"] but with live mutable state so the fake can
// update folders and workspaceFile in place.
interface MutableWorkspace {
  workspaceFolders: WorkspaceFolderLike[];
  workspaceFile: UriLike | undefined;
  getConfiguration(section: string): ConfigurationLike;
  updateWorkspaceFolders(
    start: number,
    deleteCount: number | undefined,
    ...foldersToAdd: { uri: UriLike; name?: string }[]
  ): boolean;
  onDidChangeWorkspaceFolders(listener: () => void): { dispose(): void };
}

export class FakeVscode implements VscodeLike {
  readonly configurationTarget = { Workspace: WORKSPACE_TARGET };
  config: Record<string, Record<string, unknown>> = {};
  /** When true, the next updateWorkspaceFolders call is rejected (returns false, changes nothing). */
  failNextUpdate = false;
  /** When true, configuration updates reject (title write failure). */
  failTitleUpdate = false;
  added: { path: string; name: string | undefined }[] = [];
  removed: string[] = [];
  closedTabs: string[] = [];
  titleUpdates: {
    section: string;
    key: string;
    value: unknown;
    target: unknown;
  }[] = [];

  private readonly tabs: FakeTab[] = [];
  private readonly listeners = new Set<() => void>();

  /** Simulates GitLens being installed; undefined = not installed. */
  gitlens: FakeExtension<unknown> | undefined;
  /** When false, getExtension reports vscode.git as not installed. */
  gitExtensionInstalled = true;
  /** Mirrors the built-in git extension opening a repository per added folder. */
  mirrorGitRepos = true;
  readonly gitApi = new FakeGitApi();
  private readonly gitExtension = new FakeExtension<GitExtensionExportsLike>({
    getAPI: () => this.gitApi,
  });

  readonly extensions: VscodeLike["extensions"] = {
    getExtension: <T>(extensionId: string) => {
      if (extensionId === "eamodio.gitlens") {
        return this.gitlens as unknown as ExtensionLike<T> | undefined;
      }
      if (extensionId === "vscode.git") {
        if (!this.gitExtensionInstalled) {
          return undefined;
        }
        // The built-in git extension is always active in VS Code.
        this.gitExtension.isActive = true;
        return this.gitExtension as unknown as ExtensionLike<T>;
      }
      return undefined;
    },
  };

  // The exposed workspace/window objects hold live references: the folder
  // and tab arrays are mutated in place, so no getters are needed.
  readonly workspace: MutableWorkspace = {
    workspaceFolders: [],
    workspaceFile: undefined,
    getConfiguration: (section: string): ConfigurationLike => this.getConfiguration(section),
    updateWorkspaceFolders: (
      start: number,
      deleteCount: number | undefined,
      ...toAdd: { uri: UriLike; name?: string }[]
    ): boolean => {
      if (this.failNextUpdate) {
        this.failNextUpdate = false;
        return false;
      }
      const removed = this.workspace.workspaceFolders.splice(
        start,
        deleteCount ?? 0,
        ...toAdd.map((folder) => ({
          uri: folder.uri,
          name: folder.name ?? path.basename(folder.uri.fsPath),
        })),
      );
      this.added.push(...toAdd.map((folder) => ({ path: folder.uri.fsPath, name: folder.name })));
      this.removed.push(...removed.map((folder) => folder.uri.fsPath));
      for (const listener of this.listeners) {
        listener();
      }
      // Mirror the built-in git extension: it opens a repository for each
      // added workspace folder.
      if (this.mirrorGitRepos) {
        for (const folder of toAdd) {
          this.gitApi.openRepository(folder.uri.fsPath);
        }
      }
      return true;
    },
    onDidChangeWorkspaceFolders: (listener: () => void) => {
      this.listeners.add(listener);
      return { dispose: () => this.listeners.delete(listener) };
    },
  };

  readonly window: VscodeLike["window"] = {
    tabGroups: {
      all: [{ tabs: this.tabs }],
      close: (tabs: readonly TabLike[], _preserveFocus?: boolean) => {
        const closed = new Set(tabs as readonly FakeTab[]);
        for (let i = this.tabs.length - 1; i >= 0; i--) {
          if (closed.has(this.tabs[i])) {
            this.tabs.splice(i, 1);
          }
        }
        this.closedTabs.push(...tabs.map((tab) => (tab as FakeTab).uriPath));
        return Promise.resolve(true);
      },
    },
  };

  constructor(folderPaths: string[] | undefined, workspaceFile?: UriLike) {
    this.workspace.workspaceFolders.push(
      ...(folderPaths ?? []).map((p) => ({
        uri: { scheme: "file", fsPath: p },
        name: path.basename(p),
      })),
    );
    this.workspace.workspaceFile = workspaceFile;
    // Mirror VS Code having discovered a repository per open folder.
    for (const p of folderPaths ?? []) {
      this.gitApi.openRepository(p);
    }
  }

  get folderPaths(): string[] {
    return this.workspace.workspaceFolders.map((folder) => folder.uri.fsPath);
  }

  openTabs(...uriPaths: string[]): void {
    for (const uriPath of uriPaths) {
      this.tabs.push({ uriPath, input: { uri: { fsPath: uriPath } } });
    }
  }

  get openTabPaths(): string[] {
    return this.tabs.map((tab) => tab.uriPath);
  }

  getConfiguration = (section: string): ConfigurationLike => ({
    get: <T>(key: string, defaultValue: T): T => {
      const value = this.config[section]?.[key];
      return (value === undefined ? defaultValue : value) as T;
    },
    update: (key: string, value: unknown, target: unknown) => {
      this.titleUpdates.push({ section, key, value, target });
      if (this.failTitleUpdate) {
        return Promise.reject(new Error("configuration update failed"));
      }
      this.config[section] ??= {};
      this.config[section][key] = value;
      return Promise.resolve();
    },
  });
}

export interface WtOptions {
  branch?: string;
  head?: string;
  prunable?: boolean;
}

const DEFAULT_HEAD = "0123456789abcdef0123456789abcdef01234567";

export function wt(entryPath: string, options: WtOptions = {}): WorktreeEntry {
  return {
    path: entryPath,
    head: options.head ?? DEFAULT_HEAD,
    branch: options.branch ?? null,
    prunable: options.prunable ?? false,
  };
}

function serializeEntries(entries: readonly WorktreeEntry[]): string {
  const blocks = entries.map((entry) => {
    const lines = [`worktree ${entry.path}`, `HEAD ${entry.head}`];
    if (entry.branch) {
      lines.push(`branch refs/heads/${entry.branch}`);
    } else {
      lines.push("detached");
    }
    if (entry.prunable) {
      lines.push("prunable");
    }
    return lines.join("\n");
  });
  return `${blocks.join("\n\n")}\n`;
}

export interface FakeGit {
  exec: ExecFile;
  calls: { at: number; cwd: string; args: string[] }[];
  setEntries(entries: readonly WorktreeEntry[]): void;
  /** Makes the next exec call reject with an error. */
  failOnce(): void;
}

export function createFakeGit(entries: readonly WorktreeEntry[]): FakeGit {
  let stdout = serializeEntries(entries);
  let failing = false;
  const calls: FakeGit["calls"] = [];
  const exec: ExecFile = async (_file, args, options) => {
    calls.push({ at: Date.now(), cwd: options.cwd, args: [...args] });
    if (failing) {
      failing = false;
      throw new Error("git worktree list failed");
    }
    return { stdout };
  };
  return {
    exec,
    calls,
    setEntries: (next) => {
      stdout = serializeEntries(next);
    },
    failOnce: () => {
      failing = true;
    },
  };
}
