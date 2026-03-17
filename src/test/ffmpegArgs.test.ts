import assert from "node:assert/strict";
import test from "node:test";
import { buildFinalizeCacheArgs, buildFrameExportArgs, buildTranscodeArgs, pickTranscodeEncoders } from "../core/ffmpegArgs";

test("transcode args are emitted as a safe array for webm", () => {
  const args = buildTranscodeArgs({
    inputPath: "/tmp/input.mkv",
    outputPath: "/tmp/output.webm.partial",
    container: "webm",
    maxBitrateMbps: 8,
    videoEncoder: "libvpx",
    audioEncoder: "libopus"
  });

  assert.deepEqual(args.slice(0, 8), [
    "-hide_banner",
    "-loglevel",
    "error",
    "-progress",
    "pipe:1",
    "-nostats",
    "-y",
    "-i"
  ]);
  assert.equal(args.includes("libvpx"), true);
  assert.equal(args.includes("libopus"), true);
  assert.equal(args.includes("-f"), true);
  assert.equal(args.includes("webm"), true);
  assert.equal(args.includes("/tmp/output.webm.partial"), true);
});

test("transcode args explicitly set mp4 output format for temporary files", () => {
  const args = buildTranscodeArgs({
    inputPath: "/tmp/input.mkv",
    outputPath: "/tmp/output.mp4.partial",
    container: "mp4",
    maxBitrateMbps: 8,
    videoEncoder: "libx264",
    audioEncoder: "libmp3lame"
  });

  const formatIndex = args.lastIndexOf("-f");
  assert.notEqual(formatIndex, -1);
  assert.equal(args[formatIndex + 1], "mp4");
  assert.equal(args.at(-1), "/tmp/output.mp4.partial");
  assert.equal(args.includes("frag_keyframe+empty_moov+default_base_moof"), true);
});

test("low bitrate sources keep mp4 cache bitrates modest", () => {
  const args = buildTranscodeArgs({
    inputPath: "/tmp/input.mp4",
    outputPath: "/tmp/output.mp4.partial",
    container: "mp4",
    maxBitrateMbps: 8,
    sourceBitRate: 134_571,
    sourceVideoBitRate: 91_353,
    sourceAudioBitRate: 35_418,
    videoEncoder: "libx264",
    audioEncoder: "libmp3lame"
  });

  const videoBitrateIndex = args.indexOf("-b:v");
  const audioBitrateIndex = args.indexOf("-b:a");
  assert.equal(args[videoBitrateIndex + 1], "228k");
  assert.equal(args[audioBitrateIndex + 1], "64k");
});

test("encoder selection prefers vorbis for webm audio", () => {
  const selected = pickTranscodeEncoders("webm", ["libvpx", "vorbis", "libopus", "aac"]);
  assert.deepEqual(selected, {
    videoEncoder: "libvpx",
    audioEncoder: "vorbis"
  });
});

test("encoder selection prefers aac for mp4 audio", () => {
  const selected = pickTranscodeEncoders("mp4", ["libx264", "libmp3lame", "aac", "aac_at"]);
  assert.deepEqual(selected, {
    videoEncoder: "libx264",
    audioEncoder: "aac"
  });
});

test("non-partial mp4 outputs keep faststart metadata relocation", () => {
  const args = buildTranscodeArgs({
    inputPath: "/tmp/input.mkv",
    outputPath: "/tmp/output.mp4",
    container: "mp4",
    maxBitrateMbps: 8,
    videoEncoder: "libx264",
    audioEncoder: "libmp3lame"
  });

  assert.equal(args.includes("+faststart"), true);
});

test("finalizing mp4 caches remuxes them with faststart", () => {
  const args = buildFinalizeCacheArgs({
    inputPath: "/tmp/output.mp4.partial",
    outputPath: "/tmp/output.mp4",
    container: "mp4"
  });

  assert.deepEqual(args, [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-i",
    "/tmp/output.mp4.partial",
    "-map",
    "0",
    "-c",
    "copy",
    "-movflags",
    "+faststart",
    "-f",
    "mp4",
    "/tmp/output.mp4"
  ]);
});

test("unknown bitrate sources still honor the configured bitrate ceiling", () => {
  const args = buildTranscodeArgs({
    inputPath: "/tmp/input.mp4",
    outputPath: "/tmp/output.mp4",
    container: "mp4",
    maxBitrateMbps: 8,
    videoEncoder: "libx264",
    audioEncoder: "libmp3lame"
  });

  const videoBitrateIndex = args.indexOf("-b:v");
  assert.equal(args[videoBitrateIndex + 1], "8M");
});

test("experimental encoders add strict mode", () => {
  const args = buildTranscodeArgs({
    inputPath: "/tmp/input.mkv",
    outputPath: "/tmp/output.webm",
    container: "webm",
    maxBitrateMbps: 8,
    videoEncoder: "libvpx",
    audioEncoder: "vorbis",
    enableExperimentalCodecs: true
  });

  assert.equal(args.includes("-strict"), true);
  assert.equal(args.includes("-2"), true);
});

test("frame export clamps negative timestamps to zero", () => {
  const args = buildFrameExportArgs("/tmp/input.mp4", "/tmp/frame.png", -5);
  assert.equal(args[5], "0.000");
});
