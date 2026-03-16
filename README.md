# Remote Video Preview for VS Code

[简体中文](README.zh-CN.md)

[![Release VSIX](https://github.com/MingfuYAN/vscode-remote-video-preview/actions/workflows/release-vsix.yml/badge.svg)](https://github.com/MingfuYAN/vscode-remote-video-preview/actions/workflows/release-vsix.yml)
[![Latest Release](https://img.shields.io/github/v/release/MingfuYAN/vscode-remote-video-preview)](https://github.com/MingfuYAN/vscode-remote-video-preview/releases)
[![License](https://img.shields.io/github/license/MingfuYAN/vscode-remote-video-preview)](LICENSE)

Preview local files and Remote SSH video artifacts directly inside VS Code. The extension inspects each source with `ffprobe`, decides whether direct playback is safe, and falls back to `ffmpeg`-generated compatible cache files when the embedded webview cannot play the original media reliably.

This project is built for remote-first developer workflows such as:

- security PoC recordings stored on Linux servers
- experiment outputs generated on GPU or CI hosts
- quick video inspection without downloading files out of VS Code

## Highlights

- Open local files and Remote SSH video files in a custom readonly editor.
- Reuse existing validated compatible caches before starting a new transcode.
- Generate compatible `WebM` or `MP4` playback caches with `ffmpeg`.
- Keep caches with retention rules based on age and total size.
- Inspect container, codec, stream, bitrate, duration, and size metadata in-editor.
- Export the current frame to PNG at the active playback timestamp.
- Ship user-facing UI in both English and Simplified Chinese.

## Requirements

- VS Code `1.90+`
- `ffmpeg`
- `ffprobe`

The extension invokes host-installed binaries. On a Remote SSH session, `ffmpeg` and `ffprobe` must exist on the remote machine, not only on your local computer.

## Installation

### Install from GitHub Releases

1. Open the [Releases](https://github.com/MingfuYAN/vscode-remote-video-preview/releases) page.
2. Download the latest `.vsix` asset.
3. In VS Code, run `Extensions: Install from VSIX...`.
4. Select the downloaded package.

### Build from source

```bash
git clone https://github.com/MingfuYAN/vscode-remote-video-preview.git
cd vscode-remote-video-preview
npm install
npm test
```

Then press `F5` in VS Code to launch an Extension Development Host.

## Quick Start

1. Right click a video file in Explorer.
2. Choose `Open With Remote Video Preview`.
3. If the source is only partially compatible, click `Generate Compatible Cache`.
4. Use the editor title actions to inspect metadata or export the current frame.

## Commands

The extension contributes the following commands:

- `Open With Remote Video Preview`
- `Focus Video Metadata`
- `Generate Compatible Cache`
- `Export Current Frame`
- `Show Debug Log`

`Focus Video Metadata`, `Generate Compatible Cache`, and `Export Current Frame` are also available from the custom editor title bar.

## Settings

| Setting | Description | Default |
| --- | --- | --- |
| `remoteVideoPreview.ffmpegPath` | Path or command name for `ffmpeg` | `ffmpeg` |
| `remoteVideoPreview.ffprobePath` | Path or command name for `ffprobe` | `ffprobe` |
| `remoteVideoPreview.autoTranscode` | Automatically generate a compatible cache when direct playback is not possible | `true` |
| `remoteVideoPreview.preferredContainer` | Preferred output container for generated compatible caches | `webm` |
| `remoteVideoPreview.maxBitrateMbps` | Target max bitrate for generated compatible caches | `8` |
| `remoteVideoPreview.cacheDirectory` | Optional absolute or workspace-relative cache directory | empty |
| `remoteVideoPreview.cleanupPolicy` | Cache cleanup mode: `onClose`, `sessionEnd`, `retained`, `manual` | `retained` |
| `remoteVideoPreview.cacheMaxAgeHours` | Delete retained caches older than this many hours; `0` disables age cleanup | `168` |
| `remoteVideoPreview.cacheMaxSizeGb` | Delete the oldest retained caches when total cache size exceeds this value in GB; `0` disables size cleanup | `5` |

## Cache Behavior

- By default, caches are written beside the source file in `.remote-video-preview-cache/`.
- Existing caches are validated before reuse. Incomplete or invalid outputs are ignored and rebuilt.
- New transcodes are written through a temporary file and only promoted to a final cache file after FFmpeg completes successfully.
- The default cleanup strategy is `retained`, which keeps usable caches until the configured age or size limits trim them.

## Release Workflow

This repository includes a GitHub Actions workflow that builds a `.vsix` package and uploads it to GitHub Releases automatically.

To publish a new release:

```bash
git tag v0.1.0
git push origin v0.1.0
```

Pushing a `v*` tag will:

1. install dependencies with `npm ci`
2. run `npm test`
3. package the extension as `.vsix`
4. create or update the matching GitHub Release
5. attach the `.vsix` file to the Release assets

For a local package build without creating a release:

```bash
npm run package:vsix
```

## Development

```bash
npm install
npm test
```

Useful local commands:

- `npm run compile`
- `npm run lint`
- `npm run test`
- `npm run package:vsix`

## Project Documents

- [Project intro](docs/project-intro.md)
- [Good first issues](docs/good-first-issues.md)
- [Contributing guide](CONTRIBUTING.md)
- [Security policy](SECURITY.md)

## Roadmap

- add subtitle and multi-audio-stream selection
- improve playback heuristics for more direct-play combinations
- expose cache diagnostics and cleanup statistics in the UI
- add broader validation for more remote environments beyond Remote SSH Linux

## License

[MIT](LICENSE)
