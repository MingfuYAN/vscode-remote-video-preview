import * as vscode from "vscode";
import { CleanupPolicy, PreferredContainer } from "./core/videoTypes";

export interface ExtensionConfig {
  ffmpegPath: string;
  ffprobePath: string;
  autoTranscode: boolean;
  preferredContainer: PreferredContainer;
  maxBitrateMbps: number;
  cacheDirectory: string;
  cleanupPolicy: CleanupPolicy;
  cacheMaxAgeHours: number;
  cacheMaxSizeGb: number;
}

const CONFIG_ROOT = "remoteVideoPreview";

export function getExtensionConfig(): ExtensionConfig {
  const configuration = vscode.workspace.getConfiguration(CONFIG_ROOT);
  const cacheMaxAgeHours = configuration.get<number>("cacheMaxAgeHours", 168);
  const cacheMaxSizeGb = configuration.get<number>("cacheMaxSizeGb", 5);

  return {
    ffmpegPath: configuration.get<string>("ffmpegPath", "ffmpeg").trim() || "ffmpeg",
    ffprobePath: configuration.get<string>("ffprobePath", "ffprobe").trim() || "ffprobe",
    autoTranscode: configuration.get<boolean>("autoTranscode", true),
    preferredContainer: configuration.get<PreferredContainer>("preferredContainer", "mp4"),
    maxBitrateMbps: configuration.get<number>("maxBitrateMbps", 8),
    cacheDirectory: configuration.get<string>("cacheDirectory", "").trim(),
    cleanupPolicy: configuration.get<CleanupPolicy>("cleanupPolicy", "retained"),
    cacheMaxAgeHours: Number.isFinite(cacheMaxAgeHours) ? Math.max(0, cacheMaxAgeHours) : 168,
    cacheMaxSizeGb: Number.isFinite(cacheMaxSizeGb) ? Math.max(0, cacheMaxSizeGb) : 5
  };
}
