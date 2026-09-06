/**
 * Shared workspace-folder edit helper: apply an updateWorkspaceFolders
 * edit and wait until it is reflected.
 */

import type { UriLike, VscodeLike } from "./api";

export const APPLY_TIMEOUT_MS = 3000;

/**
 * updateWorkspaceFolders is asynchronous: the workspace folders list is
 * updated only after onDidChangeWorkspaceFolders fires. Wait for that
 * event (with a timeout fallback) so consecutive edits see fresh
 * indices.
 */
export function updateFoldersAndWait(
  vscode: VscodeLike,
  start: number,
  deleteCount: number | undefined,
  ...folders: ReadonlyArray<{ uri: UriLike; name?: string }>
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
    const subscription = vscode.workspace.onDidChangeWorkspaceFolders(done);
    const fallback = setTimeout(done, APPLY_TIMEOUT_MS);
    const accepted = vscode.workspace.updateWorkspaceFolders(start, deleteCount, ...folders);
    if (!accepted) {
      done();
    }
  });
}
