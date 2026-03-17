import * as vscode from "vscode";
import { randomBytes } from "crypto";
import { CacheManager } from "./cacheManager";
import { assessPlaybackSupport, inferMimeTypeFromPath } from "./core/playbackSupport";
import { isLikelyCompleteCache } from "./core/cacheValidation";
import { formatBitrate, formatBytes, formatDuration, sleep } from "./core/utils";
import { PlaybackAssessment, PreferredContainer, TranscodeProgress, VideoProbeResult } from "./core/videoTypes";
import { getExtensionConfig } from "./config";
import { ExtensionLogger } from "./logger";
import {
  basenameForUri,
  basenameWithoutExtension,
  dirnameUri,
  formatUriForDisplay
} from "./paths";
import { ToolchainError, TranscodeJob, VideoToolchain } from "./toolchain";

export const REMOTE_VIDEO_PREVIEW_VIEW_TYPE = "remoteVideoPreview.editor";

interface WebviewActionMessage {
  type: "ready" | "generateCache" | "showMetadata" | "exportFrame" | "timeUpdate" | "playerEvent";
  currentTime?: number;
  eventName?: string;
  detail?: string;
}

interface Session {
  key: string;
  sourceUri: vscode.Uri;
  panels: Set<vscode.WebviewPanel>;
  probe?: VideoProbeResult;
  assessment?: PlaybackAssessment;
  playbackUri?: vscode.Uri;
  cacheUri?: vscode.Uri;
  currentTimeSeconds: number;
  status: string;
  warnings: string[];
  error?: string;
  transcodeJob?: TranscodeJob;
  transcodeProgress?: TranscodeProgress;
  focusMetadataToken: number;
}

interface WebviewState {
  title: string;
  sourceLabel: string;
  status: string;
  strategyLabel: string;
  warnings: string[];
  error?: string;
  playbackUrl?: string;
  playbackMimeType?: string;
  currentTimeSeconds: number;
  cachePath?: string;
  metadataItems: Array<{ label: string; value: string }>;
  streamItems: Array<{ label: string; value: string }>;
  focusMetadataToken: number;
}

class VideoDocument implements vscode.CustomDocument {
  public constructor(public readonly uri: vscode.Uri) {}

  public dispose(): void {}
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function createNonce(): string {
  return randomBytes(16).toString("hex");
}

function t(message: string, ...args: Array<string | number | boolean>): string {
  return vscode.l10n.t(message, ...args);
}

function localizeUnsupportedProblem(problem: string): string {
  if (problem.startsWith("container ")) {
    return t("container {0}", problem.slice("container ".length));
  }

  if (problem.startsWith("video codec ")) {
    return t("video codec {0}", problem.slice("video codec ".length));
  }

  if (problem.startsWith("audio codec ")) {
    return t("audio codec {0}", problem.slice("audio codec ".length));
  }

  return problem;
}

function localizeAssessmentReason(reason: string): string {
  if (reason === "No video stream was detected in the file.") {
    return t("No video stream was detected in the file.");
  }

  if (reason === "The container and codecs are compatible with VS Code webviews.") {
    return t("The container and codecs are compatible with VS Code webviews.");
  }

  if (reason === "The video stream is compatible with VS Code webviews. Audio may be missing until you generate a compatible cache.") {
    return t("The video stream is compatible with VS Code webviews. Audio may be missing until you generate a compatible cache.");
  }

  const prefix = "A compatible cache is required because ";
  const suffix = " is not supported directly.";

  if (reason.startsWith(prefix) && reason.endsWith(suffix)) {
    const rawProblems = reason.slice(prefix.length, reason.length - suffix.length);
    const localizedProblems = rawProblems
      .split(" and ")
      .map((problem) => localizeUnsupportedProblem(problem))
      .join(t(" and "));
    return t("A compatible cache is required because {0} is not supported directly.", localizedProblems);
  }

  return reason;
}

function localizeAssessmentWarnings(warnings: string[]): string[] {
  return warnings.map((warning) => {
    if (warning === "AAC audio may not play in VS Code webviews. Video playback will start immediately, and you can generate a compatible cache if audio is missing.") {
      return t("AAC audio may not play in VS Code webviews. Video playback will start immediately, and you can generate a compatible cache if audio is missing.");
    }

    return warning;
  });
}

function localizeCodecType(codecType: string): string {
  if (codecType === "video") {
    return t("video");
  }

  if (codecType === "audio") {
    return t("audio");
  }

  if (codecType === "subtitle") {
    return t("subtitle");
  }

  return codecType;
}

export class RemoteVideoPreviewProvider implements vscode.CustomReadonlyEditorProvider<VideoDocument>, vscode.Disposable {
  private readonly sessions = new Map<string, Session>();
  private readonly readinessWatchers = new Set<string>();
  private activeSessionKey?: string;

  public constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly cacheManager: CacheManager,
    private readonly toolchain: VideoToolchain,
    private readonly logger: ExtensionLogger
  ) {}

  public async openCustomDocument(
    uri: vscode.Uri,
    _openContext: vscode.CustomDocumentOpenContext,
    _token: vscode.CancellationToken
  ): Promise<VideoDocument> {
    this.logger.info("Opening custom document.", { source: uri });
    return new VideoDocument(uri);
  }

  public async resolveCustomEditor(
    document: VideoDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    const session = this.getOrCreateSession(document.uri);
    this.logger.info("Resolving custom editor.", {
      source: document.uri,
      existingPanels: session.panels.size
    });
    session.panels.add(webviewPanel);
    this.activeSessionKey = session.key;

    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: this.cacheManager.getLocalResourceRoots(document.uri)
    };
    webviewPanel.webview.html = this.getWebviewHtml(webviewPanel.webview, basenameForUri(document.uri));

    webviewPanel.onDidDispose(() => {
      void this.detachPanel(session, webviewPanel);
    });

    webviewPanel.onDidChangeViewState((event) => {
      if (event.webviewPanel.active) {
        this.activeSessionKey = session.key;
      }
    });

    webviewPanel.webview.onDidReceiveMessage((message: WebviewActionMessage) => {
      void this.handleWebviewMessage(session, webviewPanel, message);
    });

    await this.ensureSessionPrepared(session, true);
  }

  public async openWithPreview(resource?: vscode.Uri): Promise<void> {
    const targetUri = this.resolveTargetUri(resource);

    if (!targetUri) {
      this.logger.warn("Open With Preview requested without an active video resource.");
      void vscode.window.showErrorMessage(t("No video resource is active."));
      return;
    }

    this.logger.info("Open With Preview command invoked.", { source: targetUri });
    await vscode.commands.executeCommand("vscode.openWith", targetUri, REMOTE_VIDEO_PREVIEW_VIEW_TYPE);
  }

  public async showMetadata(resource?: vscode.Uri): Promise<void> {
    const targetUri = this.resolveTargetUri(resource);

    if (!targetUri) {
      this.logger.warn("Show Metadata requested without an active video resource.");
      void vscode.window.showErrorMessage(t("No video resource is active."));
      return;
    }

    const session = this.getOrCreateSession(targetUri);
    session.focusMetadataToken += 1;

    if (session.panels.size === 0) {
      this.logger.info("Show Metadata requested without an open preview; opening the custom editor.", {
        source: session.sourceUri
      });
      await this.openWithPreview(targetUri);
      return;
    }

    await this.ensureSessionPrepared(session, false);
    this.logger.info("Revealing metadata inside the active preview.", { source: session.sourceUri });
    await this.pushState(session);
  }

  public async generateCompatibleCache(resource?: vscode.Uri): Promise<void> {
    const session = await this.resolveSession(resource, false);

    if (!session) {
      return;
    }

    this.logger.info("Generate Compatible Cache command invoked.", { source: session.sourceUri });
    try {
      const job = await this.startCompatibleCache(session, true);

      if (!job) {
        void vscode.window.showInformationMessage(
          t(
            "Compatible cache is ready at {0}.",
            session.cacheUri ? formatUriForDisplay(session.cacheUri) : t("the configured cache directory")
          )
        );
        return;
      }

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: t("Generating compatible cache for {0}", basenameForUri(session.sourceUri)),
          cancellable: true
        },
        async (progress, cancellationToken) => {
          let lastPercent = 0;
          const listener = job.onProgress((update) => {
            const currentPercent = Math.max(lastPercent, Math.floor(update.percent ?? lastPercent));
            progress.report({
              increment: currentPercent - lastPercent,
              message: this.progressMessage(update)
            });
            lastPercent = currentPercent;
          });

          cancellationToken.onCancellationRequested(() => {
            job.dispose();
          });

          try {
            await job.completion;
          } finally {
            listener.dispose();
          }
        }
      );
    } catch (error) {
      this.logger.error("Generate Compatible Cache command failed.", {
        source: session.sourceUri,
        error: this.describeError(error, "ffmpegPath")
      });
      void vscode.window.showErrorMessage(this.describeError(error, "ffmpegPath"));
    }
  }

  public async exportCurrentFrame(resource?: vscode.Uri): Promise<void> {
    const session = await this.resolveSession(resource, false);

    if (!session) {
      return;
    }

    const currentTimeSeconds = Math.max(0, session.currentTimeSeconds || 0);
    this.logger.info("Export Current Frame command invoked.", {
      source: session.sourceUri,
      currentTimeSeconds: currentTimeSeconds.toFixed(3)
    });
    const suggestedName = `${basenameWithoutExtension(session.sourceUri)}-${Math.round(currentTimeSeconds * 1000)}ms.png`;
    const defaultUri = vscode.Uri.joinPath(dirnameUri(session.sourceUri), suggestedName);
    const saveUri = await vscode.window.showSaveDialog({
      defaultUri,
      filters: {
        [t("PNG Image")]: ["png"]
      },
      saveLabel: t("Export current frame")
    });

    if (!saveUri) {
      this.logger.info("Export Current Frame was cancelled.", { source: session.sourceUri });
      return;
    }

    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: t("Exporting frame from {0}", basenameForUri(session.sourceUri))
        },
        async () => {
          await this.toolchain.exportFrame(session.sourceUri, saveUri, currentTimeSeconds);
        }
      );

      void vscode.window.showInformationMessage(t("Frame exported to {0}.", formatUriForDisplay(saveUri)));
    } catch (error) {
      this.logger.error("Export Current Frame failed.", {
        source: session.sourceUri,
        output: saveUri,
        error: this.describeError(error, "ffmpegPath")
      });
      void vscode.window.showErrorMessage(this.describeError(error, "ffmpegPath"));
    }
  }

  public async dispose(): Promise<void> {
    for (const session of this.sessions.values()) {
      session.transcodeJob?.dispose();
    }

    if (getExtensionConfig().cleanupPolicy === "sessionEnd") {
      await this.cacheManager.cleanupAllSessions();
    }

    this.sessions.clear();
  }

  private getOrCreateSession(sourceUri: vscode.Uri): Session {
    const key = sourceUri.toString();
    const existingSession = this.sessions.get(key);

    if (existingSession) {
      this.logger.info("Reusing existing session.", { source: sourceUri });
      return existingSession;
    }

    const session: Session = {
      key,
      sourceUri,
      panels: new Set<vscode.WebviewPanel>(),
      currentTimeSeconds: 0,
      status: t("Inspecting source video..."),
      warnings: [],
      focusMetadataToken: 0
    };

    this.sessions.set(key, session);
    this.logger.info("Created new session.", { source: sourceUri });
    return session;
  }

  private async resolveSession(resource: vscode.Uri | undefined, autoStart: boolean): Promise<Session | undefined> {
    const targetUri = this.resolveTargetUri(resource);

    if (!targetUri) {
      this.logger.warn("Session resolution failed because no target URI was available.");
      void vscode.window.showErrorMessage(t("No video resource is active."));
      return undefined;
    }

    const session = this.getOrCreateSession(targetUri);
    await this.ensureSessionPrepared(session, autoStart);
    return session;
  }

  private resolveTargetUri(resource?: vscode.Uri): vscode.Uri | undefined {
    if (resource) {
      return resource;
    }

    if (this.activeSessionKey) {
      return this.sessions.get(this.activeSessionKey)?.sourceUri;
    }

    return vscode.window.activeTextEditor?.document.uri;
  }

  private async ensureSessionPrepared(session: Session, autoStart: boolean): Promise<void> {
    if (!session.probe) {
      this.logger.info("Starting ffprobe inspection.", { source: session.sourceUri });
      session.status = t("Inspecting source video with ffprobe...");
      await this.pushState(session);

      try {
        session.probe = await this.toolchain.probeVideo(session.sourceUri);
      } catch (error) {
        session.error = this.describeError(error, "ffprobePath");
        session.status = t("Unable to inspect the source video.");
        this.logger.error("ffprobe inspection failed.", {
          source: session.sourceUri,
          error: session.error
        });
        await this.pushState(session);
        return;
      }
    }

    const configuration = getExtensionConfig();
    session.assessment = assessPlaybackSupport(session.probe, configuration.preferredContainer);
    session.assessment.reason = localizeAssessmentReason(session.assessment.reason);
    session.assessment.warnings = localizeAssessmentWarnings(session.assessment.warnings);
    session.warnings = [...session.assessment.warnings];
    this.logger.info("Playback assessment completed.", {
      source: session.sourceUri,
      mode: session.assessment.mode,
      reason: session.assessment.reason,
      preferredContainer: configuration.preferredContainer,
      warnings: session.warnings.length
    });

    const existingCacheUri = await this.resolveExistingCompatibleCache(session, configuration.preferredContainer);

    if (existingCacheUri) {
      session.playbackUri = existingCacheUri;
      session.status = t("Using an existing compatible cache.");
      this.logger.info("Using existing compatible cache.", {
        source: session.sourceUri,
        cache: existingCacheUri
      });
      await this.pushState(session);
      return;
    }

    if (session.assessment.mode === "direct") {
      session.playbackUri = session.sourceUri;

      session.status = t("Playing the source file directly in VS Code.");
      this.logger.info("Using direct playback.", { source: session.sourceUri });
      await this.pushState(session);
      return;
    }

    session.status = session.assessment.reason;
    await this.pushState(session);

    if (autoStart && configuration.autoTranscode) {
      this.logger.info("Auto-transcode is enabled; starting compatible cache generation.", {
        source: session.sourceUri
      });
      await this.startCompatibleCache(session, true);
    }
  }

  private async startCompatibleCache(
    session: Session,
    switchPlayback: boolean,
    container: PreferredContainer = getExtensionConfig().preferredContainer
  ): Promise<TranscodeJob | undefined> {
    if (!session.probe) {
      this.logger.warn("Compatible cache requested before probe metadata existed.", { source: session.sourceUri });
      return undefined;
    }

    if (!session.assessment) {
      session.assessment = assessPlaybackSupport(session.probe, container);
    }

    session.cacheUri = await this.ensureCacheUri(session, container);

    if (await this.cacheManager.exists(session.cacheUri)) {
      const cacheIsUsable = await this.validateCompatibleCache(session, session.cacheUri, container);
      if (!cacheIsUsable) {
        this.logger.warn("Discarding incomplete compatible cache before starting a new transcode.", {
          source: session.sourceUri,
          cache: session.cacheUri
        });
        await this.cacheManager.removeQuietly(session.cacheUri);
      } else {
        if (switchPlayback || session.assessment.mode === "transcode") {
          session.playbackUri = session.cacheUri;
        }

        session.status = t("Compatible cache already exists.");
        this.logger.info("Compatible cache already exists.", {
          source: session.sourceUri,
          cache: session.cacheUri,
          switchPlayback
        });
        await this.pushState(session);
        return undefined;
      }
    }

    const transcodeOutputUri = this.partialCacheUri(session.cacheUri);
    await this.cacheManager.removeQuietly(transcodeOutputUri);
    this.cacheManager.recordSessionFile(session.key, transcodeOutputUri);

    if (session.transcodeJob) {
      this.logger.info("Compatible cache generation already running.", { source: session.sourceUri });
      return session.transcodeJob;
    }

    session.error = undefined;
    session.status = t("Starting FFmpeg transcoding...");
    session.transcodeProgress = { status: "starting", percent: 0 };
    await this.pushState(session);

    const job = await this.toolchain.startCompatibleCache(
      session.sourceUri,
      transcodeOutputUri,
      session.probe.durationSeconds,
      container,
      session.probe
    );
    this.logger.info("Compatible cache job created.", {
      source: session.sourceUri,
      cache: session.cacheUri
    });
    session.transcodeJob = job;

    const listener = job.onProgress((progressUpdate) => {
      session.transcodeProgress = progressUpdate;
      session.status = this.progressMessage(progressUpdate);
      void this.pushState(session);
    });

    void this.promoteCacheWhenReady(session, switchPlayback, transcodeOutputUri, container);

    void job.completion
      .then(async () => {
        listener.dispose();
        session.transcodeJob = undefined;
        session.transcodeProgress = { status: "finished", percent: 100 };
        await vscode.workspace.fs.rename(transcodeOutputUri, session.cacheUri!, { overwrite: true });
        if (switchPlayback || session.assessment?.mode === "transcode") {
          session.playbackUri = session.cacheUri;
        }
        if (session.cacheUri) {
          await this.cacheManager.pruneCache(session.sourceUri, [session.cacheUri]);
        }
        session.status = t("Compatible cache ready.");
        this.logger.info("Compatible cache ready.", {
          source: session.sourceUri,
          cache: session.cacheUri
        });
        await this.pushState(session);
      })
      .catch(async (error) => {
        listener.dispose();
        session.transcodeJob = undefined;
        session.error = this.describeError(error, "ffmpegPath");
        session.status = t("Compatible cache generation failed.");
        this.logger.error("Compatible cache generation failed.", {
          source: session.sourceUri,
          cache: session.cacheUri,
          error: session.error
        });
        await this.cacheManager.removeQuietly(transcodeOutputUri);
        await this.pushState(session);
      });

    return job;
  }

  private async promoteCacheWhenReady(
    session: Session,
    switchPlayback: boolean,
    transcodeOutputUri: vscode.Uri,
    container: PreferredContainer
  ): Promise<void> {
    if (!session.cacheUri || this.readinessWatchers.has(session.key) || !this.supportsGrowingPlayback(container)) {
      return;
    }

    this.readinessWatchers.add(session.key);

    try {
      while (session.transcodeJob && !session.transcodeJob.isFinished) {
        const size = await this.cacheManager.getSize(transcodeOutputUri);

        if (size !== undefined && size >= 768 * 1024) {
          if (switchPlayback || session.assessment?.mode === "transcode") {
            session.playbackUri = transcodeOutputUri;
          }

          session.status = t("Streaming the generated cache while transcoding continues.");
          this.logger.info("Switching playback to growing compatible cache.", {
            source: session.sourceUri,
            cache: session.cacheUri,
            sizeBytes: size
          });
          await this.pushState(session);
          return;
        }

        await sleep(800);
      }
    } finally {
      this.readinessWatchers.delete(session.key);
    }
  }

  private async detachPanel(session: Session, panel: vscode.WebviewPanel): Promise<void> {
    session.panels.delete(panel);
    this.logger.info("Detaching webview panel.", {
      source: session.sourceUri,
      remainingPanels: session.panels.size
    });

    if (this.activeSessionKey === session.key) {
      this.activeSessionKey = undefined;
    }

    if (session.panels.size > 0) {
      return;
    }

    if (getExtensionConfig().cleanupPolicy === "onClose") {
      session.transcodeJob?.dispose();
      await this.cacheManager.cleanupSession(session.key);
      this.logger.info("Cleaned up session cache on close.", { source: session.sourceUri });
    } else if (getExtensionConfig().cleanupPolicy !== "sessionEnd") {
      this.cacheManager.releaseSession(session.key);
    }

    this.sessions.delete(session.key);
    this.logger.info("Disposed session.", { source: session.sourceUri });
  }

  private async handleWebviewMessage(
    session: Session,
    panel: vscode.WebviewPanel,
    message: WebviewActionMessage
  ): Promise<void> {
    if (message.type !== "timeUpdate") {
      this.logger.info("Received webview message.", {
        source: session.sourceUri,
        type: message.type,
        eventName: message.eventName,
        detail: message.detail
      });
    }
    switch (message.type) {
      case "ready":
        await this.pushState(session, panel);
        break;
      case "generateCache":
        await this.generateCompatibleCache(session.sourceUri);
        break;
      case "showMetadata":
        await this.showMetadata(session.sourceUri);
        break;
      case "exportFrame":
        await this.exportCurrentFrame(session.sourceUri);
        break;
      case "timeUpdate":
        if (typeof message.currentTime === "number" && Number.isFinite(message.currentTime)) {
          session.currentTimeSeconds = message.currentTime;
        }
        break;
      case "playerEvent":
        if (message.eventName === "error") {
          const playbackCacheFailed = Boolean(
            session.cacheUri &&
            session.playbackUri &&
            session.cacheUri.toString() === session.playbackUri.toString()
          );
          const playbackSourceFailed = Boolean(
            session.playbackUri &&
            session.playbackUri.toString() === session.sourceUri.toString()
          );
          const cacheSchemeUnsupported = Boolean(
            session.cacheUri &&
            !this.cacheManager.supportsWebviewPlayback(session.cacheUri)
          );
          const cacheContainer = session.cacheUri ? this.containerForUri(session.cacheUri) : undefined;

          if (playbackCacheFailed && cacheContainer === "webm" && !session.transcodeJob) {
            const retryWarning = t("The generated WebM cache could not be loaded in the VS Code webview. Retrying with an MP4-compatible cache.");
            if (!session.warnings.includes(retryWarning)) {
              session.warnings = [retryWarning, ...session.warnings];
            }
            if (session.cacheUri) {
              await this.cacheManager.removeQuietly(session.cacheUri);
            }
            session.cacheUri = undefined;
            session.playbackUri = session.sourceUri;
            session.error = undefined;
            session.status = t("Compatible cache failed to load. Regenerating it as MP4.");
            await this.pushState(session, panel);
            await this.startCompatibleCache(session, true, "mp4");
            return;
          }

          if (playbackCacheFailed && session.assessment?.mode === "direct") {
            const fallbackWarning = cacheSchemeUnsupported
              ? t("The generated cache uses a legacy storage URI that VS Code webviews cannot stream. Falling back to the source file.")
              : t("The generated cache could not be loaded in the VS Code webview. Falling back to the source file.");
            session.playbackUri = session.sourceUri;
            session.status = t("Compatible cache failed to load. Playing the source file instead.");
            if (!session.warnings.includes(fallbackWarning)) {
              session.warnings = [fallbackWarning, ...session.warnings];
            }
            if (cacheSchemeUnsupported) {
              this.logger.warn("Discarding legacy cache URI because the webview cannot stream it.", {
                source: session.sourceUri,
                cache: session.cacheUri
              });
              session.cacheUri = undefined;
            }
            session.error = undefined;
            await this.pushState(session, panel);
            return;
          }

          const shouldAutoRecoverWithCache = playbackSourceFailed
            && session.assessment?.mode === "direct"
            && getExtensionConfig().autoTranscode
            && !session.transcodeJob
            && (!session.cacheUri || !(await this.cacheManager.exists(session.cacheUri)));

          if (shouldAutoRecoverWithCache) {
            session.error = undefined;
            session.status = t("Direct playback failed. Generating a compatible cache instead.");
            const recoveryWarning = t(
              "The source file could not be loaded directly in the VS Code webview. Generating a compatible cache instead."
            );
            if (!session.warnings.includes(recoveryWarning)) {
              session.warnings = [recoveryWarning, ...session.warnings];
            }
            await this.pushState(session, panel);
            await this.startCompatibleCache(session, true);
            return;
          }

          session.error = message.detail ?? t("The webview video element reported an unknown playback error.");
          session.status = t("The webview video element failed to load the current playback source.");
          await this.pushState(session, panel);
        }
        break;
      default:
        break;
    }
  }

  private async pushState(session: Session, targetPanel?: vscode.WebviewPanel): Promise<void> {
    const panels = targetPanel ? [targetPanel] : Array.from(session.panels);
    this.logger.info("Pushing webview state.", {
      source: session.sourceUri,
      panelCount: panels.length,
      hasPlaybackUrl: Boolean(session.playbackUri),
      status: session.status
    });

    const localResourceRoots = this.cacheManager.getLocalResourceRoots(session.sourceUri, session.cacheUri);
    this.logger.info("Resolved local resource roots.", {
      source: session.sourceUri,
      rootCount: localResourceRoots.length,
      hasCacheRoot: Boolean(session.cacheUri)
    });

    for (const panel of panels) {
      panel.webview.options = {
        ...panel.webview.options,
        localResourceRoots
      };

      const state = this.buildWebviewState(session, panel.webview);
      void Promise.resolve(panel.webview.postMessage(state))
        .then((posted) => {
          this.logger.info("Queued webview state post.", {
            source: session.sourceUri,
            posted
          });
        })
        .catch((error: unknown) => {
          this.logger.error("Failed to post state to webview.", {
            source: session.sourceUri,
            error: error instanceof Error ? error.message : String(error)
          });
        });
    }
  }

  private async ensureCacheUri(
    session: Session,
    preferredContainer: ReturnType<typeof getExtensionConfig>["preferredContainer"]
  ): Promise<vscode.Uri> {
    if (
      session.cacheUri &&
      this.cacheManager.supportsWebviewPlayback(session.cacheUri) &&
      this.containerForUri(session.cacheUri) === preferredContainer
    ) {
      this.cacheManager.recordSessionFile(session.key, session.cacheUri);
      return session.cacheUri;
    }

    if (session.cacheUri) {
      this.logger.warn("Ignoring cache URI that cannot be streamed by the webview.", {
        source: session.sourceUri,
        cache: session.cacheUri
      });
    }

    session.cacheUri = await this.cacheManager.getCacheUri(session.sourceUri, preferredContainer);
    this.cacheManager.recordSessionFile(session.key, session.cacheUri);
    await this.cacheManager.pruneCache(session.sourceUri, [session.cacheUri]);
    return session.cacheUri;
  }

  private partialCacheUri(cacheUri: vscode.Uri): vscode.Uri {
    return cacheUri.with({ path: `${cacheUri.path}.partial` });
  }

  private async resolveExistingCompatibleCache(
    session: Session,
    preferredContainer: ReturnType<typeof getExtensionConfig>["preferredContainer"]
  ): Promise<vscode.Uri | undefined> {
    for (const container of this.compatibleContainerCandidates(preferredContainer)) {
      const cacheUri = await this.ensureCacheUri(session, container);
      if (!(await this.cacheManager.exists(cacheUri))) {
        continue;
      }

      const cacheIsUsable = await this.validateCompatibleCache(session, cacheUri, container);
      if (cacheIsUsable) {
        session.cacheUri = cacheUri;
        return cacheUri;
      }

      this.logger.warn("Ignoring incomplete or unsupported compatible cache.", {
        source: session.sourceUri,
        cache: cacheUri
      });
      await this.cacheManager.removeQuietly(cacheUri);
    }

    return undefined;
  }

  private async validateCompatibleCache(
    session: Session,
    cacheUri: vscode.Uri,
    preferredContainer: PreferredContainer
  ): Promise<boolean> {
    if (!session.probe) {
      return false;
    }

    try {
      const cacheProbe = await this.toolchain.probeVideo(cacheUri);
      return isLikelyCompleteCache(session.probe, cacheProbe, preferredContainer);
    } catch (error) {
      this.logger.warn("Compatible cache validation failed.", {
        source: session.sourceUri,
        cache: cacheUri,
        error: this.describeError(error, "ffprobePath")
      });
      return false;
    }
  }

  private buildWebviewState(session: Session, webview: vscode.Webview): WebviewState {
    const metadataItems = session.probe
      ? [
          { label: t("Format"), value: session.probe.formatLongName ?? session.probe.formatName },
          { label: t("Duration"), value: formatDuration(session.probe.durationSeconds) },
          { label: t("Size"), value: formatBytes(session.probe.sizeBytes) },
          { label: t("Bitrate"), value: formatBitrate(session.probe.bitRate) }
        ]
      : [{ label: t("Format"), value: t("Waiting for ffprobe...") }];

    const streamItems = (session.probe?.streams ?? []).map((stream, index) => {
      const sizeLabel = stream.width && stream.height ? ` ${stream.width}x${stream.height}` : "";
      const audioLabel = stream.channels ? ` ${stream.channels}ch` : "";
      return {
        label: `${index + 1}. ${localizeCodecType(stream.codecType)}`,
        value: `${stream.codecName}${sizeLabel}${audioLabel}`
      };
    });

    const usingCompatibleCache = Boolean(
      session.playbackUri &&
      session.cacheUri &&
      session.playbackUri.toString() === session.cacheUri.toString()
    );
    const strategyLabel = usingCompatibleCache
      ? t("Compatible cache")
      : session.assessment
        ? session.assessment.mode === "direct"
          ? t("Direct playback")
          : t("Transcode to {0}", session.assessment.targetContainer.toUpperCase())
        : t("Inspecting");
    const playbackMimeType = this.resolvePlaybackMimeType(session, usingCompatibleCache);

    return {
      title: basenameForUri(session.sourceUri),
      sourceLabel: formatUriForDisplay(session.sourceUri),
      status: session.status,
      strategyLabel,
      warnings: session.warnings,
      error: session.error,
      playbackUrl: session.playbackUri ? webview.asWebviewUri(session.playbackUri).toString() : undefined,
      playbackMimeType,
      currentTimeSeconds: session.currentTimeSeconds,
      cachePath: session.cacheUri ? formatUriForDisplay(session.cacheUri) : undefined,
      metadataItems,
      streamItems,
      focusMetadataToken: session.focusMetadataToken
    };
  }

  private resolvePlaybackMimeType(session: Session, usingCompatibleCache: boolean): string | undefined {
    if (usingCompatibleCache && session.cacheUri) {
      return inferMimeTypeFromPath(session.cacheUri.path);
    }

    if (session.assessment?.mimeType) {
      return session.assessment.mimeType;
    }

    return inferMimeTypeFromPath(session.sourceUri.path);
  }

  private compatibleContainerCandidates(preferredContainer: PreferredContainer): PreferredContainer[] {
    return preferredContainer === "mp4" ? ["mp4", "webm"] : ["webm", "mp4"];
  }

  private containerForUri(uri: vscode.Uri): PreferredContainer | undefined {
    const path = uri.path.toLowerCase();
    if (path.endsWith(".mp4") || path.endsWith(".mp4.partial")) {
      return "mp4";
    }
    if (path.endsWith(".webm") || path.endsWith(".webm.partial")) {
      return "webm";
    }
    return undefined;
  }

  private supportsGrowingPlayback(container: PreferredContainer): boolean {
    return container === "mp4";
  }

  private progressMessage(progress: TranscodeProgress): string {
    const parts: string[] = [];

    if (progress.percent !== undefined) {
      parts.push(`${progress.percent.toFixed(0)}%`);
    }

    if (progress.processedSeconds !== undefined) {
      parts.push(t("processed {0}", formatDuration(progress.processedSeconds)));
    }

    if (progress.speed) {
      parts.push(t("speed {0}", progress.speed));
    }

    return parts.length > 0
      ? t("Transcoding {0}", parts.join(" · "))
      : t("Transcoding compatible cache...");
  }

  private describeError(error: unknown, settingName: "ffmpegPath" | "ffprobePath"): string {
    if (error instanceof ToolchainError) {
      if (error.kind === "missingBinary") {
        return t(
          "Command \"{0}\" is missing. Install it on the host or configure remoteVideoPreview.{1}.",
          error.command,
          settingName
        );
      }

      return error.details.trim() || error.message;
    }

    if (error instanceof Error) {
      return error.message;
    }

    return String(error);
  }

  private getWebviewHtml(webview: vscode.Webview, title: string): string {
    const nonce = createNonce();
    const escapedTitle = escapeHtml(title);
    const webviewStrings = {
      cachePrefix: t("Cache: "),
      cacheNotGeneratedYet: t("Cache not generated yet."),
      noCacheGeneratedYet: t("No cache generated yet.")
    };

    return `<!DOCTYPE html>
<html lang="${escapeHtml(vscode.env.language || "en")}">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; media-src ${webview.cspSource}; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapedTitle}</title>
  <style>
    :root {
      color-scheme: light dark;
    }

    body {
      margin: 0;
      padding: 18px;
      font-family: var(--vscode-font-family);
      color: var(--vscode-editor-foreground);
      background:
        radial-gradient(circle at top right, color-mix(in srgb, var(--vscode-button-background) 18%, transparent), transparent 36%),
        linear-gradient(180deg, color-mix(in srgb, var(--vscode-editor-background) 92%, black), var(--vscode-sideBar-background));
    }

    .shell {
      display: grid;
      gap: 18px;
      max-width: 1280px;
      margin: 0 auto;
    }

    .hero,
    .panel {
      border: 1px solid color-mix(in srgb, var(--vscode-editor-foreground) 16%, transparent);
      background: color-mix(in srgb, var(--vscode-editor-background) 90%, var(--vscode-sideBar-background));
      border-radius: 18px;
      box-shadow: 0 18px 36px rgba(0, 0, 0, 0.18);
    }

    .hero {
      padding: 18px 20px;
      display: flex;
      justify-content: space-between;
      gap: 16px;
      align-items: center;
      flex-wrap: wrap;
    }

    .hero h1 {
      margin: 0;
      font-size: 1.35rem;
      letter-spacing: 0.02em;
    }

    .subtitle,
    .status-text,
    .meta-value,
    .stream-value,
    .cache-path {
      color: color-mix(in srgb, var(--vscode-editor-foreground) 72%, transparent);
    }

    .subtitle,
    .cache-path {
      font-family: var(--vscode-editor-font-family);
      font-size: 0.9rem;
      word-break: break-all;
    }

    .pill-row {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      margin-top: 10px;
    }

    .pill {
      border-radius: 999px;
      padding: 6px 10px;
      font-size: 0.8rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      background: color-mix(in srgb, var(--vscode-button-background) 18%, transparent);
      border: 1px solid color-mix(in srgb, var(--vscode-button-background) 50%, transparent);
    }

    .actions {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
    }

    button {
      border: none;
      border-radius: 999px;
      padding: 10px 14px;
      font: inherit;
      cursor: pointer;
      color: var(--vscode-button-foreground);
      background: var(--vscode-button-background);
      transition: transform 120ms ease, opacity 120ms ease;
    }

    button.secondary {
      background: color-mix(in srgb, var(--vscode-button-background) 22%, transparent);
      color: var(--vscode-editor-foreground);
    }

    button:hover {
      transform: translateY(-1px);
      opacity: 0.95;
    }

    .grid {
      display: grid;
      gap: 18px;
      grid-template-columns: minmax(0, 2.2fr) minmax(280px, 1fr);
    }

    @media (max-width: 920px) {
      .grid {
        grid-template-columns: 1fr;
      }
    }

    .panel {
      padding: 18px;
    }

    .panel-focus {
      border-color: color-mix(in srgb, var(--vscode-button-background) 70%, transparent);
      box-shadow:
        0 0 0 2px color-mix(in srgb, var(--vscode-button-background) 24%, transparent),
        0 18px 36px rgba(0, 0, 0, 0.18);
      transition: box-shadow 160ms ease, border-color 160ms ease;
    }

    .player {
      width: 100%;
      border-radius: 14px;
      background: #050505;
      min-height: 360px;
    }

    .empty {
      min-height: 360px;
      border-radius: 14px;
      border: 1px dashed color-mix(in srgb, var(--vscode-editor-foreground) 24%, transparent);
      display: grid;
      place-items: center;
      padding: 24px;
      text-align: center;
    }

    .section-title {
      font-size: 0.86rem;
      text-transform: uppercase;
      letter-spacing: 0.09em;
      margin: 0 0 14px;
      color: color-mix(in srgb, var(--vscode-editor-foreground) 62%, transparent);
    }

    .status-card {
      padding: 14px;
      border-radius: 14px;
      background: color-mix(in srgb, var(--vscode-editor-background) 80%, var(--vscode-button-background));
      margin-top: 16px;
      display: grid;
      gap: 6px;
    }

    .warning,
    .error {
      padding: 10px 12px;
      border-radius: 12px;
      margin-top: 10px;
      font-size: 0.92rem;
    }

    .warning {
      background: color-mix(in srgb, var(--vscode-inputValidation-warningBackground) 82%, transparent);
      border: 1px solid color-mix(in srgb, var(--vscode-inputValidation-warningBorder) 68%, transparent);
    }

    .error {
      background: color-mix(in srgb, var(--vscode-inputValidation-errorBackground) 82%, transparent);
      border: 1px solid color-mix(in srgb, var(--vscode-inputValidation-errorBorder) 68%, transparent);
    }

    .meta-list,
    .stream-list {
      display: grid;
      gap: 12px;
    }

    .meta-item,
    .stream-item {
      display: grid;
      gap: 4px;
      padding-bottom: 10px;
      border-bottom: 1px solid color-mix(in srgb, var(--vscode-editor-foreground) 12%, transparent);
    }

    .meta-label,
    .stream-label {
      font-size: 0.76rem;
      text-transform: uppercase;
      letter-spacing: 0.07em;
      color: color-mix(in srgb, var(--vscode-editor-foreground) 52%, transparent);
    }

    .cache {
      margin-top: 16px;
      padding-top: 12px;
      border-top: 1px solid color-mix(in srgb, var(--vscode-editor-foreground) 12%, transparent);
    }
  </style>
</head>
<body>
  <div class="shell">
    <section class="hero">
      <div>
        <h1 id="title">${escapedTitle}</h1>
        <div id="sourceLabel" class="subtitle"></div>
        <div class="pill-row">
          <span class="pill" id="strategyLabel">${escapeHtml(t("Inspecting"))}</span>
        </div>
      </div>
      <div class="actions">
        <button id="generateCacheButton">${escapeHtml(t("Generate Compatible Cache"))}</button>
        <button id="showMetadataButton" class="secondary">${escapeHtml(t("Focus Metadata"))}</button>
        <button id="exportFrameButton" class="secondary">${escapeHtml(t("Export Current Frame"))}</button>
      </div>
    </section>

    <div class="grid">
      <section class="panel">
        <div class="section-title">${escapeHtml(t("Playback"))}</div>
        <video id="player" class="player" controls preload="metadata"></video>
        <div id="emptyState" class="empty">
          ${escapeHtml(t("Waiting for a playable source or compatible cache."))}
        </div>
        <div class="status-card">
          <strong id="statusHeadline">${escapeHtml(t("Inspecting source video..."))}</strong>
          <div id="statusText" class="status-text"></div>
        </div>
        <div id="messages"></div>
      </section>

      <section id="inspectionPanel" class="panel">
        <div class="section-title">${escapeHtml(t("Inspection"))}</div>
        <div id="metadata" class="meta-list"></div>
        <div class="section-title" style="margin-top: 18px;">${escapeHtml(t("Streams"))}</div>
        <div id="streams" class="stream-list"></div>
        <div class="cache">
          <div class="section-title">${escapeHtml(t("Cache"))}</div>
          <div id="cachePath" class="cache-path">${escapeHtml(t("No cache generated yet."))}</div>
        </div>
      </section>
    </div>
  </div>

  <script nonce="${nonce}">
    const strings = ${JSON.stringify(webviewStrings)};
    const vscode = acquireVsCodeApi();
    const player = document.getElementById("player");
    const emptyState = document.getElementById("emptyState");
    const title = document.getElementById("title");
    const sourceLabel = document.getElementById("sourceLabel");
    const strategyLabel = document.getElementById("strategyLabel");
    const statusHeadline = document.getElementById("statusHeadline");
    const statusText = document.getElementById("statusText");
    const metadata = document.getElementById("metadata");
    const streams = document.getElementById("streams");
    const cachePath = document.getElementById("cachePath");
    const messages = document.getElementById("messages");
    const inspectionPanel = document.getElementById("inspectionPanel");
    const generateCacheButton = document.getElementById("generateCacheButton");
    const showMetadataButton = document.getElementById("showMetadataButton");
    const exportFrameButton = document.getElementById("exportFrameButton");
    const sourceElement = document.createElement("source");
    player.append(sourceElement);

    let currentPlaybackUrl;
    let lastTimeSent = 0;
    let lastFocusMetadataToken = 0;

    function postPlayerEvent(eventName, detail) {
      vscode.postMessage({
        type: "playerEvent",
        eventName,
        detail
      });
    }

    function renderList(root, items, labelClass, valueClass) {
      root.replaceChildren();
      for (const item of items) {
        const wrapper = document.createElement("div");
        wrapper.className = root === metadata ? "meta-item" : "stream-item";

        const label = document.createElement("div");
        label.className = labelClass;
        label.textContent = item.label;

        const value = document.createElement("div");
        value.className = valueClass;
        value.textContent = item.value;

        wrapper.append(label, value);
        root.append(wrapper);
      }
    }

    function renderMessages(warnings, error) {
      messages.replaceChildren();

      for (const warning of warnings) {
        const element = document.createElement("div");
        element.className = "warning";
        element.textContent = warning;
        messages.append(element);
      }

      if (error) {
        const element = document.createElement("div");
        element.className = "error";
        element.textContent = error;
        messages.append(element);
      }
    }

    function updatePlayer(state) {
      if (!state.playbackUrl) {
        if (currentPlaybackUrl) {
          player.pause();
          sourceElement.removeAttribute("src");
          sourceElement.removeAttribute("type");
          player.removeAttribute("src");
          player.load();
          currentPlaybackUrl = undefined;
        }
        player.style.display = "none";
        emptyState.style.display = "grid";
        return;
      }

      player.style.display = "block";
      emptyState.style.display = "none";

      if (state.playbackUrl !== currentPlaybackUrl) {
        const resumeTime = state.currentTimeSeconds || 0;
        currentPlaybackUrl = state.playbackUrl;
        player.pause();
        player.removeAttribute("src");
        sourceElement.src = state.playbackUrl;
        if (state.playbackMimeType) {
          sourceElement.type = state.playbackMimeType;
        } else {
          sourceElement.removeAttribute("type");
        }
        postPlayerEvent("src-set", "Assigned playback URL: " + state.playbackUrl);
        player.load();
        player.addEventListener("loadedmetadata", () => {
          if (resumeTime > 0 && Number.isFinite(player.duration)) {
            player.currentTime = Math.min(resumeTime, player.duration || resumeTime);
          }
        }, { once: true });
      }
    }

    function revealMetadata(state) {
      if (!state.focusMetadataToken || state.focusMetadataToken === lastFocusMetadataToken) {
        return;
      }

      lastFocusMetadataToken = state.focusMetadataToken;
      inspectionPanel.scrollIntoView({ behavior: "smooth", block: "start" });
      inspectionPanel.classList.remove("panel-focus");
      void inspectionPanel.offsetWidth;
      inspectionPanel.classList.add("panel-focus");
      window.setTimeout(() => {
        inspectionPanel.classList.remove("panel-focus");
      }, 1600);
    }

    window.addEventListener("message", (event) => {
      const state = event.data;
      title.textContent = state.title;
      sourceLabel.textContent = state.sourceLabel;
      strategyLabel.textContent = state.strategyLabel;
      statusHeadline.textContent = state.status;
      statusText.textContent = state.cachePath ? strings.cachePrefix + state.cachePath : strings.cacheNotGeneratedYet;
      cachePath.textContent = state.cachePath || strings.noCacheGeneratedYet;

      renderList(metadata, state.metadataItems, "meta-label", "meta-value");
      renderList(streams, state.streamItems, "stream-label", "stream-value");
      renderMessages(state.warnings || [], state.error);
      updatePlayer(state);
      revealMetadata(state);
    });

    player.addEventListener("timeupdate", () => {
      const now = performance.now();
      if (now - lastTimeSent < 500) {
        return;
      }
      lastTimeSent = now;
      vscode.postMessage({ type: "timeUpdate", currentTime: player.currentTime });
    });

    function describePlayerState(prefix) {
      const errorCode = player.error ? player.error.code : "none";
      return prefix
        + " src=" + (player.currentSrc || "none")
        + " readyState=" + player.readyState
        + " networkState=" + player.networkState
        + " errorCode=" + errorCode;
    }

    [
      "loadstart",
      "loadedmetadata",
      "loadeddata",
      "canplay",
      "canplaythrough",
      "waiting",
      "stalled",
      "suspend",
      "emptied"
    ].forEach((eventName) => {
      player.addEventListener(eventName, () => {
        postPlayerEvent(eventName, describePlayerState(eventName));
      });
    });

    player.addEventListener("error", () => {
      postPlayerEvent("error", describePlayerState("error"));
    });

    generateCacheButton.addEventListener("click", () => vscode.postMessage({ type: "generateCache" }));
    showMetadataButton.addEventListener("click", () => vscode.postMessage({ type: "showMetadata" }));
    exportFrameButton.addEventListener("click", () => vscode.postMessage({ type: "exportFrame" }));

    vscode.postMessage({ type: "ready" });
  </script>
</body>
</html>`;
  }
}
