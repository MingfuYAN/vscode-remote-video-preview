import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { basenameForUriPath, dirnameForUriPath } from "./core/utils";

export function basenameForUri(uri: vscode.Uri): string {
  return basenameForUriPath(uri.path);
}

export function basenameWithoutExtension(uri: vscode.Uri): string {
  return path.posix.parse(basenameForUri(uri)).name;
}

export function dirnameUri(uri: vscode.Uri): vscode.Uri {
  return uri.with({ path: dirnameForUriPath(uri.path) });
}

export function toHostPath(uri: vscode.Uri): string {
  return uri.fsPath || uri.path;
}

export function formatUriForDisplay(uri: vscode.Uri): string {
  if (uri.scheme === "file") {
    return uri.fsPath;
  }

  if (uri.authority) {
    return `${uri.authority}${uri.path}`;
  }

  return uri.toString(true);
}

export function expandHomeDirectory(value: string): string {
  if (value === "~") {
    return os.homedir();
  }

  if (value.startsWith("~/")) {
    return path.join(os.homedir(), value.slice(2));
  }

  return value;
}

export function splitRelativeSegments(relativePath: string): string[] {
  return relativePath.split(/[\\/]+/).filter(Boolean);
}
