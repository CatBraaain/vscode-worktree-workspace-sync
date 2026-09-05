/**
 * Title bar behavior for untitled workspaces: write the main repository
 * folder name into `window.title` at workspace scope, instead of the
 * default "Untitled (Workspace)". Saved workspace files are left alone.
 */

import path from "node:path";
import type { VscodeLike } from "./api";

export async function applyUntitledWindowTitle(vscode: VscodeLike): Promise<void> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    return;
  }
  if (vscode.workspace.workspaceFile !== undefined) {
    return;
  }
  const folderName = path.basename(path.resolve(folders[0].uri.fsPath));
  await vscode.workspace
    .getConfiguration("window")
    .update("title", folderName, vscode.configurationTarget.Workspace);
}
