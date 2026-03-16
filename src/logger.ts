import * as vscode from "vscode";

function formatValue(value: unknown): string {
  if (value === undefined) {
    return "undefined";
  }

  if (value === null) {
    return "null";
  }

  if (value instanceof Error) {
    return JSON.stringify(value.message);
  }

  if (value instanceof vscode.Uri) {
    return JSON.stringify(value.toString(true));
  }

  if (typeof value === "string") {
    return JSON.stringify(value);
  }

  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }

  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify(String(value));
  }
}

function stringifyDetails(details?: Record<string, unknown>): string {
  if (!details) {
    return "";
  }

  const parts = Object.entries(details).map(([key, value]) => `${key}=${formatValue(value)}`);
  return parts.length > 0 ? ` ${parts.join(" ")}` : "";
}

export class ExtensionLogger implements vscode.Disposable {
  private readonly channel = vscode.window.createOutputChannel(vscode.l10n.t("Remote Video Preview"));

  public info(message: string, details?: Record<string, unknown>): void {
    this.write("INFO", message, details);
  }

  public warn(message: string, details?: Record<string, unknown>): void {
    this.write("WARN", message, details);
  }

  public error(message: string, details?: Record<string, unknown>): void {
    this.write("ERROR", message, details);
  }

  public show(preserveFocus = false): void {
    this.channel.show(preserveFocus);
  }

  public dispose(): void {
    this.channel.dispose();
  }

  private write(level: "INFO" | "WARN" | "ERROR", message: string, details?: Record<string, unknown>): void {
    this.channel.appendLine(`[${new Date().toISOString()}] [${level}] ${message}${stringifyDetails(details)}`);
  }
}
