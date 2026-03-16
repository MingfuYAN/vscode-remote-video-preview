# Security Policy

## Supported versions

Security fixes are tracked on the latest development line.

## Reporting a vulnerability

Please do not open a public issue for sensitive security problems.

Report details privately with:

- affected version or commit
- reproduction steps
- expected impact
- any available logs or sample files

Focus areas that matter for this project:

- command execution safety around `ffmpeg` and `ffprobe`
- path handling for local and remote resources
- cache file cleanup and disclosure risks
- malformed media files causing crashes or unsafe behavior

## Disclosure approach

- We will acknowledge receipt as quickly as possible.
- We will validate the issue and determine severity.
- We will prepare a fix or mitigation before public disclosure when feasible.
