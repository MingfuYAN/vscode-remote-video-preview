import { PreferredContainer } from "./videoTypes";

export interface BuildTranscodeArgsOptions {
  inputPath: string;
  outputPath: string;
  container: PreferredContainer;
  maxBitrateMbps: number;
  sourceBitRate?: number;
  sourceVideoBitRate?: number;
  sourceAudioBitRate?: number;
  videoEncoder?: string;
  audioEncoder?: string;
  enableExperimentalCodecs?: boolean;
}

export interface SelectedTranscodeEncoders {
  videoEncoder: string;
  audioEncoder: string;
}

export interface BuildFinalizeCacheArgsOptions {
  inputPath: string;
  outputPath: string;
  container: PreferredContainer;
}

function bitrateValue(bitsPerSecond: number): string {
  const safeBitsPerSecond = Math.max(32_000, Math.round(bitsPerSecond));

  if (safeBitsPerSecond >= 1_000_000 && safeBitsPerSecond % 1_000_000 === 0) {
    return `${safeBitsPerSecond / 1_000_000}M`;
  }

  return `${Math.round(safeBitsPerSecond / 1000)}k`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function roundToNearest(value: number, step: number): number {
  return Math.round(value / step) * step;
}

function deriveSourceVideoBitrate(options: BuildTranscodeArgsOptions): number | undefined {
  if (options.sourceVideoBitRate && Number.isFinite(options.sourceVideoBitRate) && options.sourceVideoBitRate > 0) {
    return options.sourceVideoBitRate;
  }

  if (options.sourceBitRate && Number.isFinite(options.sourceBitRate) && options.sourceBitRate > 0) {
    const sourceAudioBitRate = options.sourceAudioBitRate ?? 0;
    return Math.max(64_000, options.sourceBitRate - sourceAudioBitRate);
  }

  return undefined;
}

function selectVideoBitrate(options: BuildTranscodeArgsOptions): number {
  const configuredBitrate = Math.max(250_000, Math.round(options.maxBitrateMbps * 1_000_000));
  const sourceVideoBitRate = deriveSourceVideoBitrate(options);

  if (!sourceVideoBitRate) {
    return configuredBitrate;
  }

  const floor = options.container === "mp4" ? 180_000 : 220_000;
  const multiplier = options.container === "mp4" ? 2.5 : 3;
  return Math.min(configuredBitrate, Math.max(floor, Math.round(sourceVideoBitRate * multiplier)));
}

function selectAudioBitrate(options: BuildTranscodeArgsOptions, audioEncoder: string): number | undefined {
  const sourceAudioBitRate = options.sourceAudioBitRate;

  if (options.container === "webm") {
    if (audioEncoder === "libopus" || audioEncoder === "opus") {
      const derived = sourceAudioBitRate
        ? clamp(roundToNearest(sourceAudioBitRate * 1.6, 16_000), 64_000, 160_000)
        : 128_000;
      return derived;
    }

    return undefined;
  }

  if (audioEncoder === "libmp3lame") {
    return sourceAudioBitRate
      ? clamp(roundToNearest(sourceAudioBitRate * 1.8, 16_000), 64_000, 160_000)
      : 96_000;
  }

  if (audioEncoder === "aac" || audioEncoder === "aac_at") {
    return sourceAudioBitRate
      ? clamp(roundToNearest(sourceAudioBitRate * 1.5, 16_000), 64_000, 160_000)
      : 96_000;
  }

  return sourceAudioBitRate
    ? clamp(roundToNearest(sourceAudioBitRate * 1.5, 16_000), 64_000, 160_000)
    : 96_000;
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
  const audioEncoder = pickFirstAvailable(availableEncoders, ["aac", "aac_at", "libmp3lame"]);

  if (!videoEncoder || !audioEncoder) {
    throw new Error("The current ffmpeg build cannot create MP4-compatible caches because required encoders are missing.");
  }

  return { videoEncoder, audioEncoder };
}

export function buildTranscodeArgs(options: BuildTranscodeArgsOptions): string[] {
  const videoEncoder = options.videoEncoder ?? (options.container === "webm" ? "libvpx" : "libx264");
  const audioEncoder = options.audioEncoder ?? (options.container === "webm" ? "libvorbis" : "libmp3lame");
  const enableExperimentalCodecs = options.enableExperimentalCodecs ?? false;
  const outputFormat = options.container === "webm" ? "webm" : "mp4";
  const isPartialOutput = options.outputPath.toLowerCase().endsWith(".partial");
  const selectedVideoBitrate = selectVideoBitrate(options);
  const selectedBufferBitrate = Math.max(selectedVideoBitrate * 2, 512_000);
  const selectedAudioBitrate = selectAudioBitrate(options, audioEncoder);
  const videoBitrate = bitrateValue(selectedVideoBitrate);
  const bufferBitrate = bitrateValue(selectedBufferBitrate);
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
      ? ["-b:a", bitrateValue(selectedAudioBitrate ?? 128_000)]
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

  const audioArgs = ["-b:a", bitrateValue(selectedAudioBitrate ?? 96_000)];

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
    isPartialOutput ? "frag_keyframe+empty_moov+default_base_moof" : "+faststart",
    "-c:a",
    audioEncoder,
    ...audioArgs,
    "-f",
    outputFormat,
    options.outputPath
  ];
}

export function buildFinalizeCacheArgs(options: BuildFinalizeCacheArgsOptions): string[] {
  const outputFormat = options.container === "webm" ? "webm" : "mp4";

  if (options.container === "webm") {
    return [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      options.inputPath,
      "-map",
      "0",
      "-c",
      "copy",
      "-f",
      outputFormat,
      options.outputPath
    ];
  }

  return [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-i",
    options.inputPath,
    "-map",
    "0",
    "-c",
    "copy",
    "-movflags",
    "+faststart",
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
