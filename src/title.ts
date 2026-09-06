/**
 * Title bar behavior for untitled workspaces: write the default
 * `window.title` template with ${rootName} replaced by the main repository
 * folder name, so untitled windows show the folder name instead of
 * "Untitled (Workspace)". Saved workspace files are left alone.
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
  const title =
    "${dirty}${activeEditorShort}${separator}" +
    folderName +
    "${separator}${profileName}${separator}${appName}";
  await vscode.workspace
    .getConfiguration("window")
    .update("title", title, vscode.configurationTarget.Workspace);
}
