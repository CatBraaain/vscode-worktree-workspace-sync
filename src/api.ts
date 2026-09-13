/**
 * Minimal structural view of the vscode API surface this extension uses.
 * The real API object (adapted in extension.ts) and test fakes both
 * satisfy these shapes, so core logic never imports "vscode".
 */

export interface UriLike {
  readonly scheme?: string;
  readonly fsPath: string;
}

export interface WorkspaceFolderLike {
  readonly uri: UriLike;
  readonly name: string;
}

export interface DisposableLike {
  dispose(): void;
}

export interface ConfigurationLike {
  get<T>(section: string, defaultValue: T): T;
  update(section: string, value: unknown, target: unknown): PromiseLike<void>;
}

export interface TabInputLike {
  readonly uri?: UriLike;
  readonly modified?: UriLike;
}

export interface TabLike {
  readonly input?: TabInputLike;
}

export interface GitRepositoryLike {
  readonly root: UriLike;
}

export interface GitApiLike {
  readonly repositories: readonly GitRepositoryLike[];
  onDidOpenRepository(listener: (repository: GitRepositoryLike) => void): DisposableLike;
}

/** Shape of the vscode.git extension exports. */
export interface GitExtensionExportsLike {
  getAPI(version: 1): GitApiLike;
}

export interface ExtensionLike<TExports = unknown> {
  readonly isActive: boolean;
  readonly exports: TExports;
  activate(): PromiseLike<TExports>;
}

export interface VscodeLike {
  readonly workspace: {
    readonly workspaceFolders: readonly WorkspaceFolderLike[] | undefined;
    readonly workspaceFile: UriLike | undefined;
    getConfiguration(section: string): ConfigurationLike;
    updateWorkspaceFolders(
      start: number,
      deleteCount: number | undefined,
      ...foldersToAdd: ReadonlyArray<{ uri: UriLike; name?: string }>
    ): boolean;
    onDidChangeWorkspaceFolders(listener: () => void): DisposableLike;
  };
  readonly window: {
    readonly tabGroups: {
      readonly all: ReadonlyArray<{ readonly tabs: readonly TabLike[] }>;
      close(tabs: readonly TabLike[], preserveFocus?: boolean): PromiseLike<boolean>;
    };
  };
  readonly configurationTarget: { readonly Workspace: unknown };
  readonly extensions: {
    getExtension<TExports = unknown>(extensionId: string): ExtensionLike<TExports> | undefined;
  };
}

export const BUILTIN_GIT_EXTENSION_ID = "vscode.git";

/**
 * Activate the built-in git extension and return its API. Resolves with
 * undefined when the extension is not installed, failed to activate, or
 * exposes no API.
 */
export async function getGitApi(vscode: VscodeLike): Promise<GitApiLike | undefined> {
  const extension =
    vscode.extensions.getExtension<GitExtensionExportsLike>(BUILTIN_GIT_EXTENSION_ID);
  if (!extension) {
    return undefined;
  }
  if (!extension.isActive) {
    await Promise.resolve(extension.activate()).catch(() => {});
  }
  if (!extension.isActive) {
    return undefined;
  }
  return extension.exports?.getAPI(1);
}
