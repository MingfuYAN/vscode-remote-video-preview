# 项目简介

## 报名表短简介

Remote Video Preview for VS Code 是一个面向远程开发场景的原创开源 VS Code 插件，支持在本地和 `Remote SSH Linux` 环境中直接预览视频文件。插件通过 `ffprobe` 自动识别视频容器与编解码信息，在 VS Code 原生 webview 可直接播放时直接预览，在不兼容时自动调用 `ffmpeg` 生成兼容缓存并尽快切换播放，同时提供视频元数据检查与当前帧导出能力。项目聚焦远程实验结果、PoC 演示视频和模型输出视频的快速检查问题，兼顾实用性、可扩展性和开源社区协作价值。

## 长简介

Remote Video Preview for VS Code 是一个聚焦“远程开发环境下视频结果难以快速预览”这一真实痛点的原创开源项目。当前很多安全研究、计算机视觉实验、语音视频模型训练和远端摄像头采集流程，都会在远程 Linux 主机上生成体积较大、格式复杂的视频文件。开发者通常需要额外下载文件、切换播放器或手动执行转码，打断了本来的 VS Code 工作流。

本项目的核心思路是把 VS Code 扩展运行在工作区所在主机一侧，也就是本地或 Remote SSH 的远端机器上。插件在打开视频文件时，首先使用 `ffprobe` 获取容器、编解码、时长、码率、分辨率、音轨等元数据，判断该文件是否可被 VS Code webview 直接播放；如果原始视频不兼容，则自动调用 `ffmpeg` 进行兼容缓存生成，并在缓存达到可播放状态后切换到新流继续预览。这样用户不需要先下载文件到本地，也不需要手动处理各种格式差异。

项目当前实现了四类相互独立的功能：

1. 统一预览：本地与 `Remote SSH Linux` 视频文件都可以在 VS Code 中以自定义只读编辑器打开。
2. 智能转码：对不兼容的容器和编解码自动生成 `WebM` 或 `MP4` 兼容缓存。
3. 元数据检查：提供结构化元数据文档输出，便于调试编码、码率、音轨、分辨率等问题。
4. 当前帧导出：基于当前播放时间导出 PNG 图像，便于记录实验结果和问题定位。

相较于泛化的“万能视频播放器”，本项目更强调远程开发场景下的差异化价值，属于“围绕开发者真实工作流进行增强”的工具型原创开源软件。项目既有明确的可用产品形态，也具有持续演进空间，后续还可扩展字幕、音轨切换、帧序列导出、快照画廊、容器适配和远端缓存治理等能力。

## 对外宣传描述

Remote Video Preview for VS Code turns VS Code into a remote-first video inspection workspace. It lets developers preview local and Remote SSH video artifacts, inspect codec metadata, generate compatible caches with FFmpeg, and export the current frame without leaving the editor.
