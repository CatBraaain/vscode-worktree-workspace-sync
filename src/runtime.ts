/**
 * Activation boundary shared by the real extension entry point and tests:
 * resolves the main repository (workspace folder 0), applies the title
 * bar behavior, and starts the polling engine. Does nothing when no
 * workspace folder is open.
 */

import path from "node:path";
import type { VscodeLike } from "./api";
import { AutoSyncEngine } from "./engine";
import type { ExecFile } from "./porcelain";
import { applyUntitledWindowTitle } from "./title";

export interface ExtensionHandle {
  dispose(): void;
}

export function startExtension(vscode: VscodeLike, execFile: ExecFile): ExtensionHandle {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    return { dispose: () => {} };
  }
  const mainRepoPath = path.resolve(folders[0].uri.fsPath);
  // Title updates are cosmetic; a failure must not break the sync engine.
  void applyUntitledWindowTitle(vscode).catch(() => {});
  const engine = new AutoSyncEngine({ vscode, mainRepoPath, execFile });
  engine.start();
  return { dispose: () => engine.stop() };
}
