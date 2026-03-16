# Remote Video Preview for VS Code

[English](README.md)

[![Release VSIX](https://github.com/MingfuYAN/vscode-remote-video-preview/actions/workflows/release-vsix.yml/badge.svg)](https://github.com/MingfuYAN/vscode-remote-video-preview/actions/workflows/release-vsix.yml)
[![Latest Release](https://img.shields.io/github/v/release/MingfuYAN/vscode-remote-video-preview)](https://github.com/MingfuYAN/vscode-remote-video-preview/releases)
[![License](https://img.shields.io/github/license/MingfuYAN/vscode-remote-video-preview)](LICENSE)

这是一个面向远程开发场景的 VS Code 视频预览扩展。它可以直接在 VS Code 中打开本地文件和 Remote SSH 上的视频文件，先用 `ffprobe` 分析容器与编解码信息，再决定是直接播放原视频，还是调用 `ffmpeg` 生成兼容缓存后播放。

这个项目适合下面这些典型场景：

- 安全研究中的 PoC 录屏或演示视频
- 远端服务器上的模型输出视频和实验结果
- 不想先下载文件，只想在 VS Code 里快速确认内容

## 核心能力

- 用自定义只读编辑器打开本地和 Remote SSH 视频文件
- 优先复用已经验证通过的兼容缓存，避免重复转码
- 在原视频不兼容时自动生成 `WebM` 或 `MP4` 兼容缓存
- 支持按缓存保留时长和总占用大小自动清理
- 在编辑器内查看容器、流、码率、时长、文件大小等元数据
- 按当前播放时间导出 PNG 帧图
- 用户界面同时支持英文和简体中文

## 运行要求

- VS Code `1.90+`
- `ffmpeg`
- `ffprobe`

注意：扩展调用的是当前工作区主机上的二进制。如果你通过 Remote SSH 连接远端环境，那么 `ffmpeg` 和 `ffprobe` 需要安装在远端主机上。

## 安装方式

### 从 GitHub Releases 安装

1. 打开 [Releases](https://github.com/MingfuYAN/vscode-remote-video-preview/releases)
2. 下载最新的 `.vsix`
3. 在 VS Code 里执行 `Extensions: Install from VSIX...`
4. 选择下载好的安装包

### 从源码构建

```bash
git clone https://github.com/MingfuYAN/vscode-remote-video-preview.git
cd vscode-remote-video-preview
npm install
npm test
```

然后在 VS Code 里按 `F5`，启动一个 Extension Development Host 进行调试。

## 快速开始

1. 在资源管理器里右键某个视频文件
2. 选择 `Open With Remote Video Preview`
3. 如果原视频不完全兼容，点击 `Generate Compatible Cache`
4. 通过编辑器标题栏继续查看元数据或导出当前帧

## 命令列表

扩展提供以下命令：

- `Open With Remote Video Preview`
- `Focus Video Metadata`
- `Generate Compatible Cache`
- `Export Current Frame`
- `Show Debug Log`

其中 `Focus Video Metadata`、`Generate Compatible Cache` 和 `Export Current Frame` 也会出现在自定义编辑器标题栏中。

## 配置项

| 配置项 | 说明 | 默认值 |
| --- | --- | --- |
| `remoteVideoPreview.ffmpegPath` | `ffmpeg` 路径或命令名 | `ffmpeg` |
| `remoteVideoPreview.ffprobePath` | `ffprobe` 路径或命令名 | `ffprobe` |
| `remoteVideoPreview.autoTranscode` | 当无法直接播放时是否自动生成兼容缓存 | `true` |
| `remoteVideoPreview.preferredContainer` | 兼容缓存优先输出格式 | `webm` |
| `remoteVideoPreview.maxBitrateMbps` | 兼容缓存目标最大码率 | `8` |
| `remoteVideoPreview.cacheDirectory` | 可选的绝对路径或工作区相对缓存目录 | 空 |
| `remoteVideoPreview.cleanupPolicy` | 缓存清理模式：`onClose`、`sessionEnd`、`retained`、`manual` | `retained` |
| `remoteVideoPreview.cacheMaxAgeHours` | 删除超过该小时数的保留缓存，`0` 表示关闭按时间清理 | `168` |
| `remoteVideoPreview.cacheMaxSizeGb` | 缓存总大小超过该值（GB）时删除最旧缓存，`0` 表示关闭按容量清理 | `5` |

## 缓存机制

- 默认会把缓存写在源视频旁边的 `.remote-video-preview-cache/` 目录中
- 已存在的缓存不会直接盲信，而是会先验证是否完整、是否可播放
- 新转码结果会先写入临时文件，只有 FFmpeg 成功结束后才会升级成正式缓存文件
- 默认清理策略是 `retained`，会保留缓存直到超过时长或容量阈值后再裁剪

## GitHub Release 自动打包

仓库已经预留 GitHub Actions 工作流，可以自动把扩展打包成 `.vsix` 并上传到 GitHub Releases。

发布新版本时，只需要推送一个 `v*` 标签，例如：

```bash
git tag v0.1.0
git push origin v0.1.0
```

工作流会自动执行：

1. `npm ci`
2. `npm test`
3. 打包 `.vsix`
4. 创建或更新对应版本的 GitHub Release
5. 把 `.vsix` 作为 Release 附件上传

如果只想本地打包，不想发 Release，可以执行：

```bash
npm run package:vsix
```

## 本地开发

```bash
npm install
npm test
```

常用命令：

- `npm run compile`
- `npm run lint`
- `npm run test`
- `npm run package:vsix`

## 项目文档

- [项目简介](docs/project-intro.md)
- [适合新贡献者的任务](docs/good-first-issues.md)
- [贡献指南](CONTRIBUTING.md)
- [安全策略](SECURITY.md)

## 后续规划

- 支持字幕和多音轨选择
- 增强更多容器和编解码组合的直播放行策略
- 在界面中展示缓存诊断和清理统计
- 扩展到更多远程开发环境，而不只限于 Remote SSH Linux

## 许可证

[MIT](LICENSE)
