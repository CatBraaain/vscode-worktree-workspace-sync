/**
 * Minimal structural view of the vscode API surface this extension uses.
 * The real API object (adapted in extension.ts) and test fakes both
 * satisfy these shapes, so core logic never imports "vscode".
 */

export interface UriLike {
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
}
