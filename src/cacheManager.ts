import * as path from "path";
import * as vscode from "vscode";
import { buildCacheFileName } from "./core/cacheKey";
import { PreferredContainer } from "./core/videoTypes";
import { getExtensionConfig } from "./config";
import { dirnameUri, expandHomeDirectory, splitRelativeSegments } from "./paths";

interface ManagedCacheEntry {
  uri: vscode.Uri;
  mtime: number;
  size: number;
}

export class CacheManager {
  private readonly sessionFiles = new Map<string, Set<string>>();
  private static readonly defaultCacheFolderName = ".remote-video-preview-cache";
  private static readonly managedFilePrefix = "rvp-";
  private static readonly webviewPlayableSchemes = new Set(["file", "vscode-remote"]);

  public constructor(private readonly context: vscode.ExtensionContext) {}

  public async getCacheRoot(sourceUri: vscode.Uri): Promise<vscode.Uri> {
    const cacheRoot = this.computeCacheRoot(sourceUri);
    await vscode.workspace.fs.createDirectory(cacheRoot);
    return cacheRoot;
  }

  public getLocalResourceRoots(sourceUri: vscode.Uri, cacheUri?: vscode.Uri): vscode.Uri[] {
    const roots = [dirnameUri(sourceUri), this.context.extensionUri];

    if (cacheUri) {
      roots.push(dirnameUri(cacheUri));
    }

    return roots;
  }

  public supportsWebviewPlayback(uri: vscode.Uri): boolean {
    return CacheManager.webviewPlayableSchemes.has(uri.scheme);
  }

  private computeCacheRoot(sourceUri: vscode.Uri): vscode.Uri {
    const configuredDirectory = getExtensionConfig().cacheDirectory;
    if (configuredDirectory) {
      return this.resolveConfiguredDirectory(configuredDirectory, sourceUri);
    }

    const workspaceRoot = vscode.workspace.getWorkspaceFolder(sourceUri)?.uri;
    const baseUri = workspaceRoot ?? dirnameUri(sourceUri);
    return vscode.Uri.joinPath(baseUri, CacheManager.defaultCacheFolderName);
  }

  public async getCacheUri(
    sourceUri: vscode.Uri,
    container: PreferredContainer
  ): Promise<vscode.Uri> {
    const cacheRoot = await this.getCacheRoot(sourceUri);
    const fileName = buildCacheFileName(sourceUri.path, container);
    return vscode.Uri.joinPath(cacheRoot, fileName);
  }

  public recordSessionFile(sessionKey: string, uri: vscode.Uri): void {
    const fileSet = this.sessionFiles.get(sessionKey) ?? new Set<string>();
    fileSet.add(uri.toString());
    this.sessionFiles.set(sessionKey, fileSet);
  }

  public releaseSession(sessionKey: string): void {
    this.sessionFiles.delete(sessionKey);
  }

  public async cleanupSession(sessionKey: string): Promise<void> {
    const fileSet = this.sessionFiles.get(sessionKey);

    if (!fileSet) {
      return;
    }

    for (const uriText of fileSet) {
      await this.deleteQuietly(vscode.Uri.parse(uriText));
    }

    this.sessionFiles.delete(sessionKey);
  }

  public async cleanupAllSessions(): Promise<void> {
    for (const sessionKey of Array.from(this.sessionFiles.keys())) {
      await this.cleanupSession(sessionKey);
    }
  }

  public async removeQuietly(uri: vscode.Uri): Promise<void> {
    await this.deleteQuietly(uri);
  }

  public async pruneCache(sourceUri: vscode.Uri, preserveUris: Iterable<vscode.Uri> = []): Promise<void> {
    const cacheRoot = this.computeCacheRoot(sourceUri);
    await vscode.workspace.fs.createDirectory(cacheRoot);

    const preserveSet = new Set<string>([
      ...Array.from(preserveUris, (uri) => uri.toString()),
      ...this.collectTrackedUris()
    ]);
    const entries = await this.listManagedEntries(cacheRoot);
    const { cacheMaxAgeHours, cacheMaxSizeGb } = getExtensionConfig();
    const maxAgeMs = cacheMaxAgeHours > 0 ? cacheMaxAgeHours * 60 * 60 * 1000 : 0;
    const maxSizeBytes = cacheMaxSizeGb > 0 ? cacheMaxSizeGb * 1024 * 1024 * 1024 : 0;
    const now = Date.now();

    const remainingEntries: ManagedCacheEntry[] = [];

    for (const entry of entries) {
      if (preserveSet.has(entry.uri.toString())) {
        remainingEntries.push(entry);
        continue;
      }

      const expired = maxAgeMs > 0 && now - entry.mtime > maxAgeMs;
      if (expired) {
        await this.deleteQuietly(entry.uri);
        continue;
      }

      remainingEntries.push(entry);
    }

    if (maxSizeBytes <= 0) {
      return;
    }

    let totalSizeBytes = remainingEntries.reduce((sum, entry) => sum + entry.size, 0);
    if (totalSizeBytes <= maxSizeBytes) {
      return;
    }

    const deletableEntries = remainingEntries
      .filter((entry) => !preserveSet.has(entry.uri.toString()))
      .sort((left, right) => left.mtime - right.mtime);

    for (const entry of deletableEntries) {
      if (totalSizeBytes <= maxSizeBytes) {
        break;
      }

      await this.deleteQuietly(entry.uri);
      totalSizeBytes -= entry.size;
    }
  }

  public async exists(uri: vscode.Uri): Promise<boolean> {
    try {
      await vscode.workspace.fs.stat(uri);
      return true;
    } catch {
      return false;
    }
  }

  public async getSize(uri: vscode.Uri): Promise<number | undefined> {
    try {
      const stat = await vscode.workspace.fs.stat(uri);
      return stat.size;
    } catch {
      return undefined;
    }
  }

  private collectTrackedUris(): string[] {
    return Array.from(this.sessionFiles.values()).flatMap((fileSet) => Array.from(fileSet));
  }

  private async listManagedEntries(cacheRoot: vscode.Uri): Promise<ManagedCacheEntry[]> {
    try {
      const directoryEntries = await vscode.workspace.fs.readDirectory(cacheRoot);
      const managedEntries: ManagedCacheEntry[] = [];

      for (const [name, fileType] of directoryEntries) {
        if (fileType !== vscode.FileType.File || !name.startsWith(CacheManager.managedFilePrefix)) {
          continue;
        }

        const fileUri = vscode.Uri.joinPath(cacheRoot, name);

        try {
          const stat = await vscode.workspace.fs.stat(fileUri);
          managedEntries.push({
            uri: fileUri,
            mtime: stat.mtime,
            size: stat.size
          });
        } catch {
          // Ignore files that disappear during pruning.
        }
      }

      return managedEntries;
    } catch {
      return [];
    }
  }

  private resolveConfiguredDirectory(configuredDirectory: string, sourceUri: vscode.Uri): vscode.Uri {
    const expanded = expandHomeDirectory(configuredDirectory);

    if (path.isAbsolute(expanded)) {
      return vscode.Uri.file(expanded);
    }

    const anchor = vscode.workspace.getWorkspaceFolder(sourceUri)?.uri ?? dirnameUri(sourceUri);
    const segments = splitRelativeSegments(expanded);
    return segments.length > 0 ? vscode.Uri.joinPath(anchor, ...segments) : anchor;
  }

  private async deleteQuietly(uri: vscode.Uri): Promise<void> {
    try {
      await vscode.workspace.fs.delete(uri, { recursive: false, useTrash: false });
    } catch {
      // Best-effort cleanup.
    }
  }
}
