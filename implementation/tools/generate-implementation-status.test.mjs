import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

test("status report is current, self-contained, and accessible", () => {
  execFileSync(
    process.execPath,
    ["tools/generate-implementation-status.mjs", "--check"],
    { cwd: root },
  );
  const html = readFileSync(
    resolve(root, "docs/IMPLEMENTATION_STATUS.html"),
    "utf8",
  );
  assert.match(html, /<html lang="en">/);
  assert.match(html, /<meta name="viewport"/);
  assert.match(html, /<main>/);
  assert.match(html, /scope="row"/);
  assert.match(html, /COMPLETE|IN PROGRESS|BLOCKED/);
  assert.doesNotMatch(html, /https?:\/\//);
  assert.doesNotMatch(html, /<script|<img|<link/i);
});
