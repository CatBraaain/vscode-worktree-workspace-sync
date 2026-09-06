import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startExtension } from "../src/runtime";
import { createFakeGit, FakeVscode, wt } from "./helpers/fake";

const MAIN = "/repo";
const mainEntry = wt(MAIN, { branch: "main" });
const featEntry = wt("/repo/.claude/worktrees/feat-x", { branch: "feat-x" });

// SPEC 設定/pollIntervalMs + 設定変更は次のポーリングから反映: polling
// cadence and config reload without a window reload.
describe("polling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("polls no faster than 500ms even when pollIntervalMs is lower", async () => {
    const api = new FakeVscode([MAIN]);
    api.config.worktreeWorkspaceSync = { pollIntervalMs: 100 };
    const git = createFakeGit([mainEntry, featEntry]);
    await startExtension(api, git.exec);

    await vi.advanceTimersByTimeAsync(0);
    expect(git.calls).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(499);
    expect(git.calls).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(git.calls).toHaveLength(2);
    const start = git.calls[0].at;
    expect(git.calls.map((call) => call.at - start)).toEqual([0, 500]);
  });

  it("uses the configured interval when it is at least 500ms", async () => {
    const api = new FakeVscode([MAIN]);
    api.config.worktreeWorkspaceSync = { pollIntervalMs: 2500 };
    const git = createFakeGit([mainEntry, featEntry]);
    await startExtension(api, git.exec);

    await vi.advanceTimersByTimeAsync(0);
    expect(git.calls).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(2499);
    expect(git.calls).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(git.calls).toHaveLength(2);
    const start = git.calls[0].at;
    expect(git.calls.map((call) => call.at - start)).toEqual([0, 2500]);
  });

  it("reflects a pollIntervalMs change from the next poll on", async () => {
    const api = new FakeVscode([MAIN]);
    api.config.worktreeWorkspaceSync = { pollIntervalMs: 100 };
    const git = createFakeGit([mainEntry, featEntry]);
    await startExtension(api, git.exec);

    await vi.advanceTimersByTimeAsync(0);
    api.config.worktreeWorkspaceSync.pollIntervalMs = 1000;

    await vi.advanceTimersByTimeAsync(500);
    expect(git.calls).toHaveLength(2);

    await vi.advanceTimersByTimeAsync(999);
    expect(git.calls).toHaveLength(2);

    await vi.advanceTimersByTimeAsync(1);
    expect(git.calls).toHaveLength(3);
    const start = git.calls[0].at;
    expect(git.calls.map((call) => call.at - start)).toEqual([0, 500, 1500]);
  });
});
