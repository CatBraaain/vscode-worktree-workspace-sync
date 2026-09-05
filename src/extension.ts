/**
 * Real VS Code entry point. Adapts the vscode API to VscodeLike and starts
 * the extension runtime.
 */

import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import * as vscode from "vscode";
import type { VscodeLike } from "./api";
import type { ExecFile } from "./porcelain";
import { startExtension } from "./runtime";

const execFileAsync = promisify(execFileCallback);

const execFile: ExecFile = async (file, args, options) => {
  const { stdout } = await execFileAsync(file, args, {
    ...options,
    windowsHide: true,
  });
  return { stdout };
};

const api: VscodeLike = {
  workspace: {
    get workspaceFolders() {
      return vscode.workspace.workspaceFolders;
    },
    get workspaceFile() {
      return vscode.workspace.workspaceFile;
    },
    getConfiguration: (section) => vscode.workspace.getConfiguration(section),
    updateWorkspaceFolders: (start, deleteCount, ...folders) =>
      vscode.workspace.updateWorkspaceFolders(
        start,
        deleteCount,
        ...folders.map((folder) => ({
          uri: vscode.Uri.file(folder.uri.fsPath),
          name: folder.name,
        })),
      ),
    onDidChangeWorkspaceFolders: (listener) =>
      vscode.workspace.onDidChangeWorkspaceFolders(listener),
  },
  window: {
    tabGroups: {
      get all() {
        // The real Tab type is a wide union; the engine only reads
        // input.uri / input.modified, so the structural narrowing here is safe.
        return vscode.window.tabGroups.all as unknown as VscodeLike["window"]["tabGroups"]["all"];
      },
      close: (tabs, preserveFocus) =>
        vscode.window.tabGroups.close(tabs as unknown as readonly vscode.Tab[], preserveFocus),
    },
  },
  configurationTarget: vscode.ConfigurationTarget,
};

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(startExtension(api, execFile));
}

export function deactivate(): void {}
