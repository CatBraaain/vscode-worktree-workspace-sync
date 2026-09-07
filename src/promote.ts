/**
 * Startup workspace transition: when the window was opened as a single
 * folder (no saved workspace file) and sync is enabled, re-apply folder
 * 0 once so VS Code switches to an untitled multi-root workspace right
 * away. This moves the one-time full redraw of that transition to
 * startup; later worktree additions then apply without the redraw. The
 * folder's path, position, and label are unchanged.
 *
 * The re-application waits until Git-related extensions settled first
 * (see waitForTransitionReadiness): swapping folder 0 during their startup
 * repository discovery leaves GitLens views empty until a window reload.
 */

import path from "node:path";
import type { GitApiLike, GitExtensionExportsLike, VscodeLike } from "./api";
import { isUnderOrEqual } from "./core";
import { updateFoldersAndWait } from "./folders";

/** SPEC: the total readiness wait is capped at 3 seconds. */
export const READINESS_TIMEOUT_MS = 3000;

const GITLENS_EXTENSION_ID = "eamodio.gitlens";
const BUILTIN_GIT_EXTENSION_ID = "vscode.git";

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
  await waitForTransitionReadiness(vscode, path.resolve(folders[0].uri.fsPath));
  // The wait may have changed the workspace; only a still-single-folder
  // workspace takes the transition.
  const current = vscode.workspace.workspaceFolders;
  if (!current || current.length !== 1) {
    return;
  }
  await updateFoldersAndWait(vscode, 0, 1, {
    uri: current[0].uri,
    name: current[0].name,
  });
}

/**
 * Wait until swapping folder 0 is safe for Git-related extensions: when
 * GitLens is installed it finished activating, and the built-in git
 * extension opened a repository covering the main repository. Never waits
 * longer than READINESS_TIMEOUT_MS in total.
 */
export async function waitForTransitionReadiness(
  vscode: VscodeLike,
  mainRepoPath: string,
): Promise<void> {
  let capTimer: ReturnType<typeof setTimeout> | undefined;
  const capped = new Promise<void>((resolve) => {
    capTimer = setTimeout(resolve, READINESS_TIMEOUT_MS);
  });
  try {
    await Promise.race([waitForGitReadiness(vscode, mainRepoPath).catch(() => {}), capped]);
  } finally {
    clearTimeout(capTimer);
  }
}

async function waitForGitReadiness(vscode: VscodeLike, mainRepoPath: string): Promise<void> {
  // GitLens first: its activation may take a moment, and the repository
  // wait below should not start before it is active.
  await activateWithin<unknown>(vscode, GITLENS_EXTENSION_ID);
  const gitExports = await activateWithin<GitExtensionExportsLike>(
    vscode,
    BUILTIN_GIT_EXTENSION_ID,
  );
  const gitApi = gitExports?.getAPI(1);
  if (!gitApi || hasRepositoryFor(gitApi, mainRepoPath)) {
    return;
  }
  await waitForRepository(gitApi, mainRepoPath);
}

/**
 * Activate the extension with the given id. Resolves with its exports, or
 * undefined when not installed or activation failed.
 */
async function activateWithin<TExports>(
  vscode: VscodeLike,
  extensionId: string,
): Promise<TExports | undefined> {
  const extension = vscode.extensions.getExtension<TExports>(extensionId);
  if (!extension) {
    return undefined;
  }
  if (!extension.isActive) {
    await Promise.resolve(extension.activate()).catch(() => {});
  }
  return extension.isActive ? extension.exports : undefined;
}

function waitForRepository(gitApi: GitApiLike, mainRepoPath: string): Promise<void> {
  return new Promise((resolve) => {
    const subscription = gitApi.onDidOpenRepository((repository) => {
      if (coversFolder(path.resolve(repository.root.fsPath), mainRepoPath)) {
        subscription.dispose();
        resolve();
      }
    });
    // The repository may have opened between the initial check and this
    // subscription.
    if (hasRepositoryFor(gitApi, mainRepoPath)) {
      subscription.dispose();
      resolve();
    }
  });
}

function hasRepositoryFor(gitApi: GitApiLike, mainRepoPath: string): boolean {
  return gitApi.repositories.some((repository) =>
    coversFolder(path.resolve(repository.root.fsPath), mainRepoPath),
  );
}

/**
 * True when the repository is the workspace folder itself, contains it
 * (repository in a parent folder), or lives inside it (sub-folder
 * repository).
 */
function coversFolder(repositoryRoot: string, folderPath: string): boolean {
  return isUnderOrEqual(folderPath, repositoryRoot) || isUnderOrEqual(repositoryRoot, folderPath);
}
