import { ChildProcessByStdio, spawn } from "child_process";
import { Readable } from "stream";
import * as vscode from "vscode";
import { buildFrameExportArgs, buildTranscodeArgs, pickTranscodeEncoders } from "./core/ffmpegArgs";
import { PreferredContainer } from "./core/videoTypes";
import { TranscodeProgress, VideoProbeResult, VideoStreamInfo } from "./core/videoTypes";
import { getExtensionConfig } from "./config";
import { ExtensionLogger } from "./logger";
import { toHostPath } from "./paths";

interface BufferedCommandResult {
  stdout: string;
  stderr: string;
}

interface FfprobeFormatPayload {
  format_name?: string;
  format_long_name?: string;
  duration?: string;
  size?: string;
  bit_rate?: string;
}

interface FfprobeStreamPayload {
  index?: number;
  codec_type?: string;
  codec_name?: string;
  codec_long_name?: string;
  width?: number;
  height?: number;
  sample_rate?: string;
  channels?: number;
  bit_rate?: string;
  duration?: string;
}

interface FfprobePayload {
  format?: FfprobeFormatPayload;
  streams?: FfprobeStreamPayload[];
}

interface EncoderCapability {
  name: string;
  experimental: boolean;
}

export class ToolchainError extends Error {
  public constructor(
    message: string,
    public readonly kind: "missingBinary" | "processFailed",
    public readonly command: string,
    public readonly details = ""
  ) {
    super(message);
    this.name = "ToolchainError";
  }
}

export class TranscodeJob implements vscode.Disposable {
  private readonly progressEmitter = new vscode.EventEmitter<TranscodeProgress>();
  private readonly completionPromise: Promise<void>;
  private readonly state: { finished: boolean };
  private readonly childProcess: ChildProcessByStdio<null, Readable, Readable>;
  private lastLoggedPercent = -10;

  public readonly onProgress = this.progressEmitter.event;

  public constructor(
    public readonly outputUri: vscode.Uri,
    childProcess: ChildProcessByStdio<null, Readable, Readable>,
    private readonly logger: ExtensionLogger,
    private readonly sourceUri: vscode.Uri,
    durationSeconds?: number
  ) {
    this.state = { finished: false };
    this.childProcess = childProcess;
    this.completionPromise = this.bindLifecycle(childProcess, durationSeconds);
  }

  public get completion(): Promise<void> {
    return this.completionPromise;
  }

  public get isFinished(): boolean {
    return this.state.finished;
  }

  public dispose(): void {
    if (!this.state.finished) {
      this.childProcess.kill("SIGTERM");
    }
    this.progressEmitter.dispose();
  }

  private bindLifecycle(
    childProcess: ChildProcessByStdio<null, Readable, Readable>,
    durationSeconds?: number
  ): Promise<void> {
    childProcess.stdout.setEncoding("utf8");
    childProcess.stderr.setEncoding("utf8");

    return new Promise<void>((resolve, reject) => {
      let stdoutBuffer = "";
      let stderrBuffer = "";
      const progressState: Record<string, string> = {};

      const flushProgressLine = (rawLine: string): void => {
        const line = rawLine.trim();

        if (!line) {
          return;
        }

        const separatorIndex = line.indexOf("=");
        if (separatorIndex < 0) {
          return;
        }

        const key = line.slice(0, separatorIndex);
        const value = line.slice(separatorIndex + 1);
        progressState[key] = value;

        if (key === "progress") {
          const progress = parseProgress(progressState, durationSeconds);
          this.logProgress(progress);
          this.progressEmitter.fire(progress);
        }
      };

      childProcess.stdout.on("data", (chunk: string) => {
        stdoutBuffer += chunk;
        const lines = stdoutBuffer.split(/\r?\n/);
        stdoutBuffer = lines.pop() ?? "";

        for (const line of lines) {
          flushProgressLine(line);
        }
      });

      childProcess.stderr.on("data", (chunk: string) => {
        stderrBuffer += chunk;
      });

      childProcess.on("error", (error: NodeJS.ErrnoException) => {
        this.state.finished = true;
        this.progressEmitter.dispose();
        this.logger.error("FFmpeg child process errored.", {
          source: this.sourceUri,
          output: this.outputUri,
          command: childProcess.spawnfile,
          code: error.code,
          message: error.message
        });

        if (error.code === "ENOENT") {
          reject(new ToolchainError(`Command not found: ${childProcess.spawnfile}`, "missingBinary", childProcess.spawnfile));
          return;
        }

        reject(new ToolchainError(error.message, "processFailed", childProcess.spawnfile, stderrBuffer));
      });

      childProcess.on("close", (exitCode, signal) => {
        this.state.finished = true;
        if (exitCode === 0) {
          this.logger.info("FFmpeg transcoding finished.", {
            source: this.sourceUri,
            output: this.outputUri
          });
          this.progressEmitter.fire({ status: "finished", percent: 100 });
          this.progressEmitter.dispose();
          resolve();
          return;
        }

        this.progressEmitter.dispose();
        const failureMessage = signal
          ? `Process was terminated by signal ${signal}.`
          : `Process exited with code ${String(exitCode)}.`;
        this.logger.error("FFmpeg transcoding failed.", {
          source: this.sourceUri,
          output: this.outputUri,
          exitCode: exitCode ?? "null",
          signal: signal ?? "none",
          stderr: stderrBuffer.trim()
        });
        reject(new ToolchainError(failureMessage, "processFailed", childProcess.spawnfile, stderrBuffer));
      });
    });
  }

  private logProgress(progress: TranscodeProgress): void {
    if (progress.status === "finished") {
      return;
    }

    const percent = Math.floor(progress.percent ?? 0);
    if (percent < this.lastLoggedPercent + 10) {
      return;
    }

    this.lastLoggedPercent = percent;
    this.logger.info("FFmpeg transcoding progress.", {
      source: this.sourceUri,
      output: this.outputUri,
      percent: progress.percent?.toFixed(1),
      processedSeconds: progress.processedSeconds?.toFixed(3),
      speed: progress.speed ?? "unknown"
    });
  }
}

function parseNumber(value: string | number | undefined): number | undefined {
  if (value === undefined || value === "") {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseStream(stream: FfprobeStreamPayload): VideoStreamInfo {
  return {
    index: stream.index ?? 0,
    codecType: stream.codec_type ?? "unknown",
    codecName: stream.codec_name ?? "unknown",
    codecLongName: stream.codec_long_name,
    width: stream.width,
    height: stream.height,
    sampleRate: parseNumber(stream.sample_rate),
    channels: stream.channels,
    bitRate: parseNumber(stream.bit_rate),
    durationSeconds: parseNumber(stream.duration)
  };
}

function parseProgress(payload: Record<string, string>, durationSeconds?: number): TranscodeProgress {
  const timeField = payload.out_time;
  let processedSeconds: number | undefined;

  if (timeField) {
    const segments = timeField.split(":").map((segment) => Number(segment));
    if (segments.length === 3 && segments.every((segment) => Number.isFinite(segment))) {
      const [hours = 0, minutes = 0, seconds = 0] = segments;
      processedSeconds = (hours * 3600) + (minutes * 60) + seconds;
    }
  }

  if (processedSeconds === undefined) {
    const rawValue = parseNumber(payload.out_time_ms);
    if (rawValue !== undefined) {
      processedSeconds = rawValue / 1_000_000;
    }
  }

  const percent = durationSeconds && processedSeconds !== undefined
    ? Math.min(100, Math.max(0, (processedSeconds / durationSeconds) * 100))
    : undefined;

  return {
    status: payload.progress === "end" ? "finished" : "running",
    percent,
    processedSeconds,
    speed: payload.speed
  };
}

async function runBufferedCommand(
  command: string,
  args: string[],
  logger?: ExtensionLogger,
  context?: Record<string, unknown>
): Promise<BufferedCommandResult> {
  logger?.info("Starting external command.", {
    command,
    args,
    ...context
  });
  const childProcess = spawn(command, args, {
    shell: false,
    stdio: ["ignore", "pipe", "pipe"]
  });

  childProcess.stdout.setEncoding("utf8");
  childProcess.stderr.setEncoding("utf8");

  return new Promise<BufferedCommandResult>((resolve, reject) => {
    let stdout = "";
    let stderr = "";

    childProcess.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });

    childProcess.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    childProcess.on("error", (error: NodeJS.ErrnoException) => {
      logger?.error("External command errored.", {
        command,
        args,
        ...context,
        code: error.code,
        message: error.message
      });
      if (error.code === "ENOENT") {
        reject(new ToolchainError(`Command not found: ${command}`, "missingBinary", command));
        return;
      }

      reject(new ToolchainError(error.message, "processFailed", command, stderr));
    });

    childProcess.on("close", (exitCode) => {
      if (exitCode === 0) {
        logger?.info("External command finished.", {
          command,
          ...context,
          stdoutBytes: stdout.length,
          stderrBytes: stderr.length
        });
        resolve({ stdout, stderr });
        return;
      }

      logger?.error("External command failed.", {
        command,
        args,
        ...context,
        exitCode: exitCode ?? "null",
        stderr: stderr.trim()
      });
      reject(
        new ToolchainError(
          `Command exited with code ${String(exitCode)}.`,
          "processFailed",
          command,
          stderr
        )
      );
    });
  });
}

export class VideoToolchain {
  private encoderCachePromise?: Promise<Map<string, EncoderCapability>>;

  public constructor(private readonly logger: ExtensionLogger) {}

  public async probeVideo(sourceUri: vscode.Uri): Promise<VideoProbeResult> {
    const configuration = getExtensionConfig();
    const sourcePath = toHostPath(sourceUri);
    const { stdout } = await runBufferedCommand(
      configuration.ffprobePath,
      [
        "-v",
        "quiet",
        "-print_format",
        "json",
        "-show_format",
        "-show_streams",
        sourcePath
      ],
      this.logger,
      {
        source: sourceUri,
        sourcePath
      }
    );

    const parsed = JSON.parse(stdout) as FfprobePayload;
    const format = parsed.format ?? {};
    this.logger.info("Parsed ffprobe metadata.", {
      source: sourceUri,
      formatName: format.format_name ?? "unknown",
      streamCount: parsed.streams?.length ?? 0,
      durationSeconds: format.duration ?? "unknown"
    });

    return {
      formatName: format.format_name ?? "unknown",
      formatLongName: format.format_long_name,
      containerNames: (format.format_name ?? "unknown").split(",").map((value) => value.trim()),
      durationSeconds: parseNumber(format.duration),
      sizeBytes: parseNumber(format.size),
      bitRate: parseNumber(format.bit_rate),
      streams: (parsed.streams ?? []).map((stream) => parseStream(stream))
    };
  }

  public async startCompatibleCache(
    sourceUri: vscode.Uri,
    outputUri: vscode.Uri,
    durationSeconds: number | undefined,
    container: PreferredContainer
  ): Promise<TranscodeJob> {
    const configuration = getExtensionConfig();
    const sourcePath = toHostPath(sourceUri);
    const outputPath = toHostPath(outputUri);
    const encoderCapabilities = await this.getAvailableEncoders(configuration.ffmpegPath);
    const selectedEncoders = pickTranscodeEncoders(container, encoderCapabilities.keys());
    const enableExperimentalCodecs = [selectedEncoders.videoEncoder, selectedEncoders.audioEncoder].some((encoderName) => {
      return encoderCapabilities.get(encoderName)?.experimental ?? false;
    });
    const args = buildTranscodeArgs({
      inputPath: sourcePath,
      outputPath,
      container,
      maxBitrateMbps: configuration.maxBitrateMbps,
      videoEncoder: selectedEncoders.videoEncoder,
      audioEncoder: selectedEncoders.audioEncoder,
      enableExperimentalCodecs
    });
    this.logger.info("Starting FFmpeg compatible cache generation.", {
      source: sourceUri,
      output: outputUri,
      container,
      maxBitrateMbps: configuration.maxBitrateMbps,
      ffmpegPath: configuration.ffmpegPath,
      videoEncoder: selectedEncoders.videoEncoder,
      audioEncoder: selectedEncoders.audioEncoder,
      enableExperimentalCodecs
    });
    const childProcess = spawn(
      configuration.ffmpegPath,
      args,
      {
        shell: false,
        stdio: ["ignore", "pipe", "pipe"]
      }
    );

    return new TranscodeJob(outputUri, childProcess, this.logger, sourceUri, durationSeconds);
  }

  public async exportFrame(
    sourceUri: vscode.Uri,
    outputUri: vscode.Uri,
    seconds: number
  ): Promise<void> {
    const configuration = getExtensionConfig();
    const sourcePath = toHostPath(sourceUri);
    const outputPath = toHostPath(outputUri);
    await runBufferedCommand(
      configuration.ffmpegPath,
      buildFrameExportArgs(sourcePath, outputPath, seconds),
      this.logger,
      {
        source: sourceUri,
        output: outputUri,
        seconds: seconds.toFixed(3)
      }
    );
  }

  private async getAvailableEncoders(ffmpegPath: string): Promise<Map<string, EncoderCapability>> {
    if (!this.encoderCachePromise) {
      this.encoderCachePromise = this.loadAvailableEncoders(ffmpegPath);
    }

    return this.encoderCachePromise;
  }

  private async loadAvailableEncoders(ffmpegPath: string): Promise<Map<string, EncoderCapability>> {
    const { stdout } = await runBufferedCommand(
      ffmpegPath,
      ["-hide_banner", "-encoders"],
      this.logger,
      {
        commandPurpose: "detect-encoders"
      }
    );

    const encoders = new Map<string, EncoderCapability>();

    for (const line of stdout.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z\.]{6})\s+([^\s]+)\s+/);
      if (match?.[1] && match[2]) {
        encoders.set(match[2], {
          name: match[2],
          experimental: match[1][3] === "X"
        });
      }
    }

    this.logger.info("Detected ffmpeg encoders.", {
      encoderCount: encoders.size,
      hasLibopus: encoders.has("libopus"),
      hasLibvorbis: encoders.has("libvorbis"),
      hasVorbis: encoders.has("vorbis"),
      hasLibvpx: encoders.has("libvpx"),
      hasLibmp3lame: encoders.has("libmp3lame")
    });

    return encoders;
  }
}
