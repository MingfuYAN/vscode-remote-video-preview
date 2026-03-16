# Good First Issues

These issues are intentionally sized for new contributors. They cover documentation, testing, UX, and focused code changes.

1. Add a status badge that distinguishes direct playback, cache playback, and failed transcoding.
2. Add unit tests for cache cleanup policies: `onClose`, `sessionEnd`, and `manual`.
3. Improve metadata rendering with stream icons and clearer audio/video labeling.
4. Add a warning banner when the source contains multiple audio streams but only the first is used.
5. Add support for configurable cache readiness thresholds before switching playback.
6. Improve error messages for missing `ffmpeg` and `ffprobe` on Remote SSH hosts.
7. Add a command to open the generated cache in the explorer or reveal it in the file tree.
8. Document Remote SSH installation tips for Ubuntu, Debian, and CentOS hosts.
