import assert from "node:assert/strict";
import test from "node:test";
import { assessPlaybackSupport, inferMimeTypeFromPath } from "../core/playbackSupport";
import { VideoProbeResult } from "../core/videoTypes";

function makeProbeResult(overrides: Partial<VideoProbeResult>): VideoProbeResult {
  return {
    formatName: "mp4",
    containerNames: ["mp4"],
    streams: [
      { index: 0, codecType: "video", codecName: "h264", width: 1920, height: 1080 },
      { index: 1, codecType: "audio", codecName: "mp3" }
    ],
    ...overrides
  };
}

test("direct playback is allowed for h264 + mp3 in mp4", () => {
  const assessment = assessPlaybackSupport(makeProbeResult({}), "webm");
  assert.equal(assessment.mode, "direct");
  assert.equal(assessment.mimeType, "video/mp4");
});

test("aac audio in mp4 still allows direct playback with a warning", () => {
  const assessment = assessPlaybackSupport(
    makeProbeResult({
      streams: [
        { index: 0, codecType: "video", codecName: "h264", width: 1280, height: 720 },
        { index: 1, codecType: "audio", codecName: "aac" }
      ]
    }),
    "webm"
  );

  assert.equal(assessment.mode, "direct");
  assert.equal(assessment.mimeType, "video/mp4");
  assert.match(assessment.reason, /audio may be missing/i);
  assert.equal(assessment.warnings.length > 0, true);
});

test("unsupported containers are transcoded to the preferred output", () => {
  const assessment = assessPlaybackSupport(
    makeProbeResult({
      formatName: "matroska",
      containerNames: ["matroska"],
      streams: [
        { index: 0, codecType: "video", codecName: "hevc", width: 3840, height: 2160 },
        { index: 1, codecType: "audio", codecName: "aac" }
      ]
    }),
    "mp4"
  );

  assert.equal(assessment.mode, "transcode");
  assert.equal(assessment.targetContainer, "mp4");
  assert.match(assessment.reason, /video codec/i);
});

test("mime type inference recognizes common previewable video files", () => {
  assert.equal(inferMimeTypeFromPath("/tmp/demo.webm"), "video/webm");
  assert.equal(inferMimeTypeFromPath("/tmp/demo.mp4"), "video/mp4");
  assert.equal(inferMimeTypeFromPath("/tmp/demo.mov"), "video/mp4");
  assert.equal(inferMimeTypeFromPath("/tmp/demo.ogv"), "video/ogg");
  assert.equal(inferMimeTypeFromPath("/tmp/demo.bin"), undefined);
});
