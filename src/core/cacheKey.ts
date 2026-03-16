import { createHash } from "crypto";
import * as path from "path";
import { PreferredContainer } from "./videoTypes";
import { slugifyName } from "./utils";

export function extensionForContainer(container: PreferredContainer): string {
  return container;
}

export function buildCacheFileName(sourcePath: string, container: PreferredContainer): string {
  const parsed = path.parse(sourcePath);
  const safeBaseName = slugifyName(parsed.name);
  const digest = createHash("sha1").update(sourcePath).digest("hex").slice(0, 10);
  return `rvp-${safeBaseName}-${digest}.${extensionForContainer(container)}`;
}
