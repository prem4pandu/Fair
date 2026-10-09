import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { listFiles } from "./manifest-enatega-ui.mjs";

test("ignores dependency, build and env artefacts but keeps source", () => {
  const root = mkdtempSync(join(tmpdir(), "manifest-"));
  for (const dir of [
    "app/node_modules/x",
    "app/.next/cache",
    "app/.expo",
    "app/dist",
    "app/.turbo",
    "app/src",
  ]) {
    mkdirSync(join(root, dir), { recursive: true });
  }
  writeFileSync(join(root, "app/node_modules/x/index.js"), "");
  writeFileSync(join(root, "app/.next/cache/a"), "");
  writeFileSync(join(root, "app/.expo/state.json"), "{}");
  writeFileSync(join(root, "app/dist/bundle.js"), "");
  writeFileSync(join(root, "app/.turbo/cookies.json"), "{}");
  writeFileSync(join(root, "app/.env.local"), "SECRET=1");
  writeFileSync(join(root, "app/.env.production"), "SECRET=1");
  writeFileSync(join(root, "app/.env"), "SECRET=1");
  writeFileSync(join(root, "app/.DS_Store"), "");
  writeFileSync(join(root, "app/next-env.d.ts"), "generated");
  writeFileSync(join(root, "app/tsconfig.tsbuildinfo"), "generated");
  writeFileSync(join(root, "app/src/page.tsx"), "export {}");
  writeFileSync(join(root, "app/.env.example"), "KEY=");

  assert.deepEqual(listFiles(root), ["app/.env.example", "app/src/page.tsx"]);
});
