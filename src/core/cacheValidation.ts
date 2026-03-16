import { assessPlaybackSupport } from "./playbackSupport";
import { PreferredContainer, VideoProbeResult } from "./videoTypes";

export function isLikelyCompleteCache(
  sourceProbe: VideoProbeResult,
  cacheProbe: VideoProbeResult,
  preferredContainer: PreferredContainer
): boolean {
  const cachePlayback = assessPlaybackSupport(cacheProbe, preferredContainer);
  if (cachePlayback.mode !== "direct") {
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
