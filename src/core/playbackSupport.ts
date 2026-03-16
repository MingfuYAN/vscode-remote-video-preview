import * as path from "path";
import { PlaybackAssessment, PreferredContainer, VideoProbeResult } from "./videoTypes";
import { normalizeCodecName } from "./utils";

const DIRECT_SUPPORT = {
  mp4: {
    containers: new Set(["mp4", "mov"]),
    videoCodecs: new Set(["h264", "avc1"]),
    audioCodecs: new Set(["", "mp3", "mp2", "mp1"])
  },
  webm: {
    containers: new Set(["webm", "matroska"]),
    videoCodecs: new Set(["vp8", "vp9"]),
    audioCodecs: new Set(["", "vorbis", "opus"])
  },
  ogg: {
    containers: new Set(["ogg", "ogv"]),
    videoCodecs: new Set(["theora"]),
    audioCodecs: new Set(["", "vorbis", "opus", "flac"])
  }
} as const;

function pickContainer(containerNames: string[]): keyof typeof DIRECT_SUPPORT | undefined {
  for (const containerName of containerNames) {
    const normalized = normalizeCodecName(containerName);
    for (const [key, support] of Object.entries(DIRECT_SUPPORT)) {
      if (support.containers.has(normalized)) {
        return key as keyof typeof DIRECT_SUPPORT;
      }
    }
  }

  return undefined;
}

export function mimeTypeForContainer(container: string): string {
  switch (container) {
    case "mp4":
      return "video/mp4";
    case "webm":
      return "video/webm";
    case "ogg":
      return "video/ogg";
    default:
      return "video/mp4";
  }
}

export function inferMimeTypeFromPath(filePath: string): string | undefined {
  const extension = path.extname(filePath).toLowerCase();

  switch (extension) {
    case ".mp4":
    case ".m4v":
    case ".mov":
      return "video/mp4";
    case ".webm":
      return "video/webm";
    case ".ogg":
    case ".ogv":
      return "video/ogg";
    default:
      return undefined;
  }
}

export function assessPlaybackSupport(
  probe: VideoProbeResult,
  preferredContainer: PreferredContainer
): PlaybackAssessment {
  const warnings: string[] = [];
  const primaryVideo = probe.streams.find((stream) => stream.codecType === "video");
  const audioStreams = probe.streams.filter((stream) => stream.codecType === "audio");

  if (!primaryVideo) {
    return {
      mode: "transcode",
      reason: "No video stream was detected in the file.",
      warnings,
      mimeType: mimeTypeForContainer(preferredContainer),
      targetContainer: preferredContainer,
      targetExtension: preferredContainer
    };
  }

  const selectedContainer = pickContainer(probe.containerNames);
  const videoCodec = normalizeCodecName(primaryVideo.codecName);
  const audioCodecs = audioStreams.map((stream) => normalizeCodecName(stream.codecName));
  const supportProfile = selectedContainer ? DIRECT_SUPPORT[selectedContainer] : undefined;
  const videoSupported = supportProfile ? supportProfile.videoCodecs.has(videoCodec) : false;
  const audioSupported = supportProfile
    ? audioCodecs.every((codecName) => supportProfile.audioCodecs.has(codecName))
    : false;
  const containerSupported = Boolean(supportProfile);

  if (audioCodecs.includes("aac")) {
    warnings.push("AAC audio may not play in VS Code webviews. Video playback will start immediately, and you can generate a compatible cache if audio is missing.");
  }

  if (selectedContainer && supportProfile && videoSupported && audioSupported) {
    return {
      mode: "direct",
      reason: "The container and codecs are compatible with VS Code webviews.",
      warnings,
      mimeType: mimeTypeForContainer(selectedContainer),
      targetContainer: selectedContainer === "ogg" ? "webm" : selectedContainer,
      targetExtension: selectedContainer
    };
  }

  if (selectedContainer && supportProfile && containerSupported && videoSupported && !audioSupported) {
    return {
      mode: "direct",
      reason: "The video stream is compatible with VS Code webviews. Audio may be missing until you generate a compatible cache.",
      warnings,
      mimeType: mimeTypeForContainer(selectedContainer),
      targetContainer: preferredContainer,
      targetExtension: selectedContainer
    };
  }

  const problems: string[] = [];

  if (!supportProfile) {
    problems.push(`container ${probe.containerNames.join(", ") || "unknown"}`);
  }

  if (!videoSupported) {
    problems.push(`video codec ${primaryVideo.codecName || "unknown"}`);
  }

  if (!audioSupported && audioStreams.length > 0) {
    problems.push(`audio codec ${audioCodecs.join(", ")}`);
  }

  return {
    mode: "transcode",
    reason: `A compatible cache is required because ${problems.join(" and ")} is not supported directly.`,
    warnings,
    mimeType: mimeTypeForContainer(preferredContainer),
    targetContainer: preferredContainer,
    targetExtension: preferredContainer
  };
}
