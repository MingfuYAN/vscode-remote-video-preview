import { assessPlaybackSupport } from "./playbackSupport";
import { PreferredContainer, VideoProbeResult } from "./videoTypes";
import { normalizeCodecName } from "./utils";

function usesStableCacheProfile(cacheProbe: VideoProbeResult, preferredContainer: PreferredContainer): boolean {
  const videoStream = cacheProbe.streams.find((stream) => stream.codecType === "video");
  const audioCodecs = cacheProbe.streams
    .filter((stream) => stream.codecType === "audio")
    .map((stream) => normalizeCodecName(stream.codecName));

  if (!videoStream) {
    return false;
  }

  const containerNames = cacheProbe.containerNames.map((containerName) => normalizeCodecName(containerName));
  const videoCodec = normalizeCodecName(videoStream.codecName);

  if (preferredContainer === "mp4") {
    const containerSupported = containerNames.some((containerName) => containerName === "mp4" || containerName === "mov");
    const videoSupported = videoCodec === "h264" || videoCodec === "avc1";
    const audioSupported = audioCodecs.every((codecName) => codecName === "aac");
    return containerSupported && videoSupported && audioSupported;
  }

  const containerSupported = containerNames.some((containerName) => containerName === "webm" || containerName === "matroska");
  const videoSupported = videoCodec === "vp8" || videoCodec === "vp9";
  const audioSupported = audioCodecs.every((codecName) => codecName === "vorbis" || codecName === "opus");
  return containerSupported && videoSupported && audioSupported;
}

export function isLikelyCompleteCache(
  sourceProbe: VideoProbeResult,
  cacheProbe: VideoProbeResult,
  preferredContainer: PreferredContainer
): boolean {
  const cachePlayback = assessPlaybackSupport(cacheProbe, preferredContainer);
  if (cachePlayback.mode !== "direct") {
    return false;
  }

  if (!usesStableCacheProfile(cacheProbe, preferredContainer)) {
    return false;
  }

  const sourceHasAudio = sourceProbe.streams.some((stream) => stream.codecType === "audio");
  const cacheHasAudio = cacheProbe.streams.some((stream) => stream.codecType === "audio");

  if (sourceHasAudio && !cacheHasAudio) {
    return false;
  }

  const sourceDurationSeconds = sourceProbe.durationSeconds;
  const cacheDurationSeconds = cacheProbe.durationSeconds;

  if (sourceDurationSeconds === undefined) {
    return true;
  }

  if (cacheDurationSeconds === undefined) {
    return false;
  }

  const toleranceSeconds = Math.max(2, sourceDurationSeconds * 0.02);
  return cacheDurationSeconds + toleranceSeconds >= sourceDurationSeconds;
}
