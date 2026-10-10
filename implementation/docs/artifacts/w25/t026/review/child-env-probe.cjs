/**
 * Reviewer-owned, independent child-environment probe for T-026A (task-4 / w25-review).
 *
 * Deliberately NOT a copy of the owner's fixture: it records a truncated SHA-256
 * of every secret-named value instead of the value itself, plus its parent pid,
 * so the analysis can attribute each observation to the harness boundary without
 * writing secret material (even deterministic test material) into the repo.
 *
 * Loaded into every node process through NODE_OPTIONS=--require while the smoke
 * harness runs with a deliberately poisoned ambient environment. It swallows
 * every error so it can never change the harness result.
 */
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const SENSITIVE_NAME =
  /(SECRET|PASSWORD|PASSWD|PASSPHRASE|PEPPER|TOKEN|CREDENTIAL|PRIVATE_KEY|API_?KEY|_KEY$|^DATABASE_URL$|^REDIS_URL$)/i;

const out = path.join(__dirname, "probe-children.jsonl");

try {
  const present = {};
  for (const [name, value] of Object.entries(process.env))
    if (SENSITIVE_NAME.test(name))
      present[name] = crypto
        .createHash("sha256")
        .update(String(value))
        .digest("hex")
        .slice(0, 16);
  fs.appendFileSync(
    out,
    `${JSON.stringify({
      pid: process.pid,
      ppid: process.ppid,
      argv: process.argv.slice(1, 4),
      cwd: process.cwd(),
      nodeOptionsRequired: String(process.env.NODE_OPTIONS ?? "").includes(
        "child-env-probe",
      ),
      present,
    })}\n`,
  );
} catch {
  /* observation must never influence the run */
}
