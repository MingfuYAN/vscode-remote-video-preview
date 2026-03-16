import assert from "node:assert/strict";
import test from "node:test";
import { isLikelyCompleteCache } from "../core/cacheValidation";
import { VideoProbeResult } from "../core/videoTypes";

function makeProbeResult(overrides: Partial<VideoProbeResult>): VideoProbeResult {
  return {
    formatName: "webm",
    containerNames: ["webm"],
    durationSeconds: 120,
    streams: [
      { index: 0, codecType: "video", codecName: "vp8", width: 1280, height: 720 },
      { index: 1, codecType: "audio", codecName: "vorbis" }
    ],
    ...overrides
  };
}

test("complete cache is accepted when duration is within tolerance", () => {
  assert.equal(
    isLikelyCompleteCache(
      makeProbeResult({ containerNames: ["mp4"], formatName: "mp4", streams: [
        { index: 0, codecType: "video", codecName: "h264", width: 1280, height: 720 },
        { index: 1, codecType: "audio", codecName: "aac" }
      ] }),
      makeProbeResult({ durationSeconds: 118.5 }),
      "webm"
    ),
    true
  );
});

test("cache is rejected when it is missing audio for a source that has audio", () => {
  assert.equal(
    isLikelyCompleteCache(
      makeProbeResult({ containerNames: ["mp4"], formatName: "mp4", streams: [
        { index: 0, codecType: "video", codecName: "h264", width: 1280, height: 720 },
        { index: 1, codecType: "audio", codecName: "aac" }
      ] }),
      makeProbeResult({ streams: [{ index: 0, codecType: "video", codecName: "vp8", width: 1280, height: 720 }] }),
      "webm"
    ),
    false
  );
});

test("cache is rejected when duration is far shorter than the source", () => {
  assert.equal(
    isLikelyCompleteCache(
      makeProbeResult({ containerNames: ["mp4"], formatName: "mp4", streams: [
        { index: 0, codecType: "video", codecName: "h264", width: 1280, height: 720 },
        { index: 1, codecType: "audio", codecName: "aac" }
      ] }),
      makeProbeResult({ durationSeconds: 90 }),
      "webm"
    ),
    false
  );
});
