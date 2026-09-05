/**
 * Pure sync logic: poll interval clamping, worktree target selection,
 * folder naming, and workspace diff computation.
 */

import path from "node:path";
import type { WorktreeEntry } from "./porcelain";

/** Spec: the effective polling interval is max(requested, 500) ms. */
export const MIN_POLL_INTERVAL_MS = 500;

export function effectivePollIntervalMs(requested: number): number {
  return Math.max(MIN_POLL_INTERVAL_MS, requested);
}

/** True when `child` is strictly below `parent` (equality is excluded). */
export function isStrictlyUnder(child: string, parent: string): boolean {
  const rel = path.relative(parent, child);
  if (rel === "" || path.isAbsolute(rel)) {
    return false;
  }
  return rel.split(path.sep)[0] !== "..";
}

/** True when `child` equals `parent` or is below it. */
export function isUnderOrEqual(child: string, parent: string): boolean {
  return child === parent || isStrictlyUnder(child, parent);
}

/**
 * Select the sync targets from porcelain entries: living worktrees of the
 * main repository (not prunable, not the main repository itself — bare
 * repositories never become entries at parse time), optionally restricted
 * to worktrees strictly below one of `roots` (each root is relative to
 * the main repository or absolute).
 * A path that exactly equals a root is not "strictly below" it, so it is
 * excluded.
 */
export function filterTargetEntries(
  entries: readonly WorktreeEntry[],
  mainRepoPath: string,
  roots: readonly string[],
): WorktreeEntry[] {
  const main = path.resolve(mainRepoPath);
  const rootAbs = roots.map((root) => path.resolve(main, root));
  const seen = new Set<string>();
  const targets: WorktreeEntry[] = [];
  for (const entry of entries) {
    if (entry.prunable) {
      continue;
    }
    const entryPath = path.resolve(entry.path);
    if (entryPath === main || seen.has(entryPath)) {
      continue;
    }
    if (rootAbs.length > 0 && !rootAbs.some((root) => isStrictlyUnder(entryPath, root))) {
      continue;
    }
    seen.add(entryPath);
    targets.push(entry);
  }
  return targets;
}

const CLAUDE_WORKTREES_RE = /[\\/]\.claude[\\/]worktrees[\\/]/;

/** Folder label shown in the explorer for a synced worktree. */
export function folderNameFor(entry: WorktreeEntry): string {
  const base = entry.branch ?? `(detached ${entry.head.slice(0, 7)})`;
  return CLAUDE_WORKTREES_RE.test(entry.path) ? `${base}  ·  agent` : base;
}

export interface SyncDiff {
  /** Target worktree paths that are not workspace folders yet. */
  toAdd: string[];
  /** Managed folder paths that are no longer sync targets. */
  toRemove: string[];
}

/**
 * Diff sync targets against the workspace. `managed` holds paths this
 * extension added (or adopted because they were targets), so folders the
 * user added on their own are never removed.
 */
export function computeSyncDiff(
  targetPaths: readonly string[],
  workspaceFolderPaths: readonly string[],
  managed: ReadonlySet<string>,
): SyncDiff {
  const inWorkspace = new Set(workspaceFolderPaths);
  const targets = new Set(targetPaths);
  return {
    toAdd: targetPaths.filter((p) => !inWorkspace.has(p)),
    toRemove: [...managed].filter((p) => !targets.has(p)),
  };
}
