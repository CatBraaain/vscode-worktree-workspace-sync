/**
 * Startup workspace transition: when the window was opened as a single
 * folder (no saved workspace file) and sync is enabled, re-apply folder
 * 0 once so VS Code switches to an untitled multi-root workspace right
 * away. This moves the one-time full redraw of that transition to
 * startup; later worktree additions then apply without the redraw. The
 * folder's path, position, and label are unchanged.
 */

import type { VscodeLike } from "./api";
import { updateFoldersAndWait } from "./folders";

export async function promoteToUntitledWorkspace(vscode: VscodeLike): Promise<void> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length !== 1) {
    return;
  }
  if (vscode.workspace.workspaceFile !== undefined) {
    return;
  }
  const enabled = vscode.workspace.getConfiguration("worktreeWorkspaceSync").get("enabled", true);
  if (!enabled) {
    return;
  }
  await updateFoldersAndWait(vscode, 0, 1, {
    uri: folders[0].uri,
    name: folders[0].name,
  });
}
