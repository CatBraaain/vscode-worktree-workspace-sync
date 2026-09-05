/**
 * Parsing of `git worktree list --porcelain` output, plus an injectable
 * runner so tests can feed porcelain text without spawning git.
 */

export interface WorktreeEntry {
  readonly path: string;
  readonly head: string;
  readonly branch: string | null;
  readonly prunable: boolean;
}

export type ExecFile = (
  file: string,
  args: readonly string[],
  options: { cwd: string },
) => Promise<{ stdout: string }>;

export function parseWorktreePorcelain(stdout: string): WorktreeEntry[] {
  const blocks: string[][] = [];
  let current: string[] = [];
  for (const raw of stdout.split("\n")) {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (line === "") {
      if (current.length > 0) {
        blocks.push(current);
        current = [];
      }
    } else {
      current.push(line);
    }
  }
  if (current.length > 0) {
    blocks.push(current);
  }

  const entries: WorktreeEntry[] = [];
  for (const block of blocks) {
    let worktreePath: string | undefined;
    let head: string | undefined;
    let branch: string | null = null;
    let bare = false;
    let prunable = false;
    for (const line of block) {
      const spaceAt = line.indexOf(" ");
      const key = spaceAt === -1 ? line : line.slice(0, spaceAt);
      const value = spaceAt === -1 ? "" : line.slice(spaceAt + 1);
      switch (key) {
        case "worktree":
          worktreePath = value;
          break;
        case "HEAD":
          head = value;
          break;
        case "branch":
          branch = value.replace(/^refs\/heads\//, "");
          break;
        case "bare":
          bare = true;
          break;
        case "prunable":
          prunable = true;
          break;
        // "detached" and "locked" markers and unknown keys are not
        // needed by the sync logic and are ignored.
      }
    }
    // Bare repositories and blocks without a worktree path or a HEAD
    // line are never sync targets, so they do not become entries.
    if (worktreePath === undefined || bare || head === undefined) {
      continue;
    }
    entries.push({ path: worktreePath, head, branch, prunable });
  }
  return entries;
}

export async function listWorktrees(cwd: string, execFile: ExecFile): Promise<WorktreeEntry[]> {
  const { stdout } = await execFile("git", ["worktree", "list", "--porcelain"], {
    cwd,
  });
  return parseWorktreePorcelain(stdout);
}
