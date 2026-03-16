import assert from "node:assert/strict";
import test from "node:test";
import { buildCacheFileName } from "../core/cacheKey";

test("cache file names are deterministic and keep the target extension", () => {
  const first = buildCacheFileName("/remote/workspace/demo clip.mkv", "webm");
  const second = buildCacheFileName("/remote/workspace/demo clip.mkv", "webm");

  assert.equal(first, second);
  assert.match(first, /^rvp-demo-clip-[a-f0-9]{10}\.webm$/);
});
