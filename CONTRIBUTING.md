# Contributing

Thanks for contributing to Remote Video Preview for VS Code.

## Development workflow

1. Install dependencies with `npm install`
2. Run `npm test`
3. Press `F5` in VS Code to launch an Extension Development Host
4. Test with at least one directly playable file and one file that requires transcoding

## Expectations

- Keep changes focused and avoid unrelated refactors.
- Use argument arrays with `spawn`, never shell-string command execution.
- Preserve the remote-first architecture: file access and FFmpeg execution should stay on the workspace host.
- Add or update tests for pure logic modules when behavior changes.
- Update docs when user-facing commands or settings change.

## Suggested areas for contributors

- Direct-play compatibility heuristics
- FFmpeg progress handling
- Better metadata UI
- Remote host installation guidance
- Cache management tests

## Pull request checklist

- `npm test` passes locally
- README or docs updated if needed
- No debug logging left behind
- Behavior verified with at least one remote or simulated remote file path
