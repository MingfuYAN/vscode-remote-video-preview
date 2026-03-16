export type PreferredContainer = "mp4" | "webm";

export type CleanupPolicy = "onClose" | "sessionEnd" | "retained" | "manual";

export interface VideoStreamInfo {
  index: number;
  codecType: string;
  codecName: string;
  codecLongName?: string;
  width?: number;
  height?: number;
  sampleRate?: number;
  channels?: number;
  bitRate?: number;
  durationSeconds?: number;
}

export interface VideoProbeResult {
  formatName: string;
  formatLongName?: string;
  containerNames: string[];
  durationSeconds?: number;
  sizeBytes?: number;
  bitRate?: number;
  streams: VideoStreamInfo[];
}

export interface PlaybackAssessment {
  mode: "direct" | "transcode";
  reason: string;
  warnings: string[];
  mimeType: string;
  targetContainer: PreferredContainer;
  targetExtension: string;
}

export interface TranscodeProgress {
  status: "starting" | "running" | "finished";
  percent?: number;
  processedSeconds?: number;
  speed?: string;
}
