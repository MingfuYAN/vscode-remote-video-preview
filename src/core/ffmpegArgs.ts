import { PreferredContainer } from "./videoTypes";

export interface BuildTranscodeArgsOptions {
  inputPath: string;
  outputPath: string;
  container: PreferredContainer;
  maxBitrateMbps: number;
  videoEncoder?: string;
  audioEncoder?: string;
  enableExperimentalCodecs?: boolean;
}

export interface SelectedTranscodeEncoders {
  videoEncoder: string;
  audioEncoder: string;
}

function bitrateValue(megabitsPerSecond: number): string {
  return `${Math.max(1, Math.round(megabitsPerSecond))}M`;
}

function pickFirstAvailable(availableEncoders: Set<string>, candidates: string[]): string | undefined {
  return candidates.find((candidate) => availableEncoders.has(candidate));
}

export function pickTranscodeEncoders(
  container: PreferredContainer,
  availableEncodersInput: Iterable<string>
): SelectedTranscodeEncoders {
  const availableEncoders = new Set(Array.from(availableEncodersInput, (encoder) => encoder.trim()).filter(Boolean));

  if (container === "webm") {
    const videoEncoder = pickFirstAvailable(availableEncoders, ["libvpx"]);
    const audioEncoder = pickFirstAvailable(availableEncoders, ["libvorbis", "vorbis"]);

    if (!videoEncoder || !audioEncoder) {
      throw new Error("The current ffmpeg build cannot create WebM-compatible caches because a Vorbis encoder is missing.");
    }

    return { videoEncoder, audioEncoder };
  }

  const videoEncoder = pickFirstAvailable(availableEncoders, ["libx264"]);
  const audioEncoder = pickFirstAvailable(availableEncoders, ["aac_at", "aac", "libmp3lame"]);

  if (!videoEncoder || !audioEncoder) {
    throw new Error("The current ffmpeg build cannot create MP4-compatible caches because required encoders are missing.");
  }

  return { videoEncoder, audioEncoder };
}

export function buildTranscodeArgs(options: BuildTranscodeArgsOptions): string[] {
  const videoBitrate = bitrateValue(options.maxBitrateMbps);
  const bufferBitrate = bitrateValue(options.maxBitrateMbps * 2);
  const videoEncoder = options.videoEncoder ?? (options.container === "webm" ? "libvpx" : "libx264");
  const audioEncoder = options.audioEncoder ?? (options.container === "webm" ? "libvorbis" : "aac");
  const enableExperimentalCodecs = options.enableExperimentalCodecs ?? false;
  const outputFormat = options.container === "webm" ? "webm" : "mp4";
  const baseArgs = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-progress",
    "pipe:1",
    "-nostats",
    "-y",
    "-i",
    options.inputPath,
    "-map",
    "0:v:0",
    "-map",
    "0:a?"
  ];
  const strictExperimentalArgs = enableExperimentalCodecs ? ["-strict", "-2"] : [];

  if (options.container === "webm") {
    const audioArgs = audioEncoder === "libopus" || audioEncoder === "opus"
      ? ["-b:a", "160k"]
      : ["-q:a", "4"];

    return [
      ...baseArgs,
      "-c:v",
      videoEncoder,
      "-deadline",
      "realtime",
      "-cpu-used",
      "5",
      "-row-mt",
      "1",
      ...strictExperimentalArgs,
      "-b:v",
      videoBitrate,
      "-maxrate",
      videoBitrate,
      "-bufsize",
      bufferBitrate,
      "-c:a",
      audioEncoder,
      ...audioArgs,
      "-f",
      outputFormat,
      options.outputPath
    ];
  }

  const audioArgs = ["-b:a", "192k"];

  return [
    ...baseArgs,
    "-c:v",
    videoEncoder,
    "-preset",
    "veryfast",
    "-tune",
    "fastdecode",
    "-pix_fmt",
    "yuv420p",
    ...strictExperimentalArgs,
    "-b:v",
    videoBitrate,
    "-maxrate",
    videoBitrate,
    "-bufsize",
    bufferBitrate,
    "-movflags",
    "+faststart",
    "-c:a",
    audioEncoder,
    ...audioArgs,
    "-f",
    outputFormat,
    options.outputPath
  ];
}

export function buildFrameExportArgs(inputPath: string, outputPath: string, seconds: number): string[] {
  const safeTime = Math.max(0, Number.isFinite(seconds) ? seconds : 0);

  return [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-ss",
    safeTime.toFixed(3),
    "-i",
    inputPath,
    "-frames:v",
    "1",
    outputPath
  ];
}
