/**
 * Title bar behavior for untitled workspaces: write the default
 * `window.title` template with ${rootName} replaced by the main repository
 * folder name, so untitled windows show the folder name instead of
 * "Untitled (Workspace)". Single-folder and saved-workspace windows are
 * left alone: a workspace-scope write there would land in the
 * repository's .vscode/settings.json instead of VS Code's untitled
 * workspace storage.
 */

import path from "node:path";
import type { VscodeLike } from "./api";

export async function applyUntitledWindowTitle(vscode: VscodeLike): Promise<void> {
  if (vscode.workspace.workspaceFile?.scheme !== "untitled") {
    return;
  }
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
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
