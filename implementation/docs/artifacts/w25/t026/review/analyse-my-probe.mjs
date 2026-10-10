import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
const file = process.argv[2];
const h = (v) => createHash("sha256").update(v).digest("hex").slice(0, 16);
const poison = {
  ACCESS_TOKEN_SECRET: "poisoned-ambient-access-token-secret-000",
  REFRESH_TOKEN_PEPPER: "poisoned-ambient-refresh-pepper-000000000",
  PUBLIC_ACCESS_SECRET: "poisoned-ambient-public-access-secret-0000",
  DATABASE_URL: "postgresql://poisoned:poisoned@poisoned.invalid:5432/poisoned",
  REDIS_URL: "redis://poisoned.invalid:6379/0",
};
const deterministic = {
  ACCESS_TOKEN_SECRET: Buffer.alloc(32, 1).toString("base64url"),
  REFRESH_TOKEN_PEPPER: Buffer.alloc(32, 2).toString("base64url"),
  PUBLIC_ACCESS_SECRET: Buffer.alloc(32, 7).toString("base64url"),
};
const lines = readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
console.log(`node processes observed: ${lines.length}`);
let leaks = 0;
for (const line of lines) {
  const hit = Object.keys(poison).filter((n) => line.present[n] === h(poison[n]));
  const det = Object.keys(deterministic).filter((n) => line.present[n] === h(deterministic[n]));
  const tag = hit.length ? "POISONED-AMBIENT" : det.length ? "deterministic-harness-values" : "filtered/other";
  if (hit.length) leaks++;
  console.log(`pid=${line.pid} ppid=${line.ppid} probe=${line.nodeOptionsRequired} cwd=${line.cwd}`);
  console.log(`  argv=${JSON.stringify(line.argv)}`);
  console.log(`  sensitive names present: ${JSON.stringify(Object.keys(line.present).sort())}`);
  console.log(`  classification: ${tag}${hit.length ? " <- LEAK: " + hit.join(",") : ""}`);
}
console.log(`\nprocesses that received a poisoned ambient value: ${leaks}`);
process.exitCode = leaks ? 1 : 0;
