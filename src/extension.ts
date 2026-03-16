import * as vscode from "vscode";
import { CacheManager } from "./cacheManager";
import { ExtensionLogger } from "./logger";
import { RemoteVideoPreviewProvider, REMOTE_VIDEO_PREVIEW_VIEW_TYPE } from "./videoPreviewProvider";
import { VideoToolchain } from "./toolchain";

let provider: RemoteVideoPreviewProvider | undefined;
let logger: ExtensionLogger | undefined;

export function activate(context: vscode.ExtensionContext): void {
  logger = new ExtensionLogger();
  const cacheManager = new CacheManager(context);
  const toolchain = new VideoToolchain(logger);
  provider = new RemoteVideoPreviewProvider(context, cacheManager, toolchain, logger);
  logger.info("Activating extension.");

  context.subscriptions.push(
    logger,
    vscode.window.registerCustomEditorProvider(REMOTE_VIDEO_PREVIEW_VIEW_TYPE, provider, {
      supportsMultipleEditorsPerDocument: true,
      webviewOptions: {
        retainContextWhenHidden: true
      }
    }),
    vscode.commands.registerCommand("remoteVideoPreview.openWithPreview", async (resource?: vscode.Uri) => {
      await provider?.openWithPreview(resource);
    }),
    vscode.commands.registerCommand("remoteVideoPreview.showMetadata", async (resource?: vscode.Uri) => {
      await provider?.showMetadata(resource);
    }),
    vscode.commands.registerCommand("remoteVideoPreview.generateCompatibleCache", async (resource?: vscode.Uri) => {
      await provider?.generateCompatibleCache(resource);
    }),
    vscode.commands.registerCommand("remoteVideoPreview.exportCurrentFrame", async (resource?: vscode.Uri) => {
      await provider?.exportCurrentFrame(resource);
    }),
    vscode.commands.registerCommand("remoteVideoPreview.showDebugLog", () => {
      logger?.show();
    })
  );
}

export async function deactivate(): Promise<void> {
  logger?.info("Deactivating extension.");
  await provider?.dispose();
}
