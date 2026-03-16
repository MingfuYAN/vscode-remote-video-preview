import * as path from "path";

export function basenameForUriPath(uriPath: string): string {
  return path.posix.basename(uriPath);
}

export function dirnameForUriPath(uriPath: string): string {
  return path.posix.dirname(uriPath);
}

export function formatDuration(seconds?: number): string {
  if (seconds === undefined || Number.isNaN(seconds) || seconds < 0) {
    return "unknown";
  }

  const rounded = Math.floor(seconds);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const remaining = rounded % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`;
  }

  return `${minutes}:${String(remaining).padStart(2, "0")}`;
}

export function formatBytes(bytes?: number): string {
  if (bytes === undefined || Number.isNaN(bytes) || bytes < 0) {
    return "unknown";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

export function formatBitrate(bitRate?: number): string {
  if (bitRate === undefined || Number.isNaN(bitRate) || bitRate <= 0) {
    return "unknown";
  }

  return `${(bitRate / 1_000_000).toFixed(2)} Mbps`;
}

export function normalizeCodecName(codecName: string | undefined): string {
  return (codecName ?? "").trim().toLowerCase();
}

export function slugifyName(input: string): string {
  const slug = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "video";
}

export function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}
