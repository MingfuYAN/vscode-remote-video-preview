import assert from "node:assert/strict";
import test from "node:test";
import { buildFrameExportArgs, buildTranscodeArgs, pickTranscodeEncoders } from "../core/ffmpegArgs";

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

test("encoder selection prefers vorbis for webm audio", () => {
  const selected = pickTranscodeEncoders("webm", ["libvpx", "vorbis", "libopus", "aac"]);
  assert.deepEqual(selected, {
    videoEncoder: "libvpx",
    audioEncoder: "vorbis"
  });
});

test("encoder selection prefers mp3 for mp4 audio", () => {
  const selected = pickTranscodeEncoders("mp4", ["libx264", "libmp3lame", "aac", "aac_at"]);
  assert.deepEqual(selected, {
    videoEncoder: "libx264",
    audioEncoder: "libmp3lame"
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
