/**
 * Reviewer-owned adversarial tests for the A1/A2 fix (task-6 / w25-review).
 * These are NOT the owner's tests: each case is an attempt to get a
 * credential-bearing or code-injecting ambient value into a child, or to make
 * the fingerprint unstable.
 */
import {
  assertNoInheritedSecrets,
  buildChildEnvironment,
  describeAmbientHazard,
  fingerprintDeterministicSecrets,
  redactCredentials,
  scanAmbientHazards,
  smokeSecrets,
  urlUserinfo,
} from "../../../../../e2e/smoke/environment.mjs";

let failures = 0;
const check = (label, condition, detail) => {
  console.log(`${condition ? "OK      " : "COUNTEREXAMPLE"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!condition) failures++;
};

// 1. the vectors the review named must not be on the passthrough list any more.
const vectors = {
  NODE_OPTIONS: "--require /tmp/evil.cjs",
  NODE_PATH: "/tmp/evil-modules",
  NODE_EXTRA_CA_CERTS: "/tmp/evil-ca.pem",
  DOCKER_HOST: "tcp://deploy:s3cr3t@docker.invalid:2376",
  DOCKER_CONTEXT: "attacker",
  DOCKER_TLS_VERIFY: "1",
  DOCKER_CERT_PATH: "/tmp/evil-certs",
};
const built = buildChildEnvironment(vectors, { APP_ENV: "development" });
for (const name of Object.keys(vectors))
  check(`builder drops ambient ${name}`, !(name in built), `keys=${Object.keys(built).join(",")}`);

// 1b. if a future edit re-adds one, the run-time guard must fail, not pass.
for (const name of Object.keys(vectors)) {
  const forced = { ...built, [name]: vectors[name] };
  let threw = false;
  try {
    assertNoInheritedSecrets(vectors, forced, { APP_ENV: "development" });
  } catch {
    threw = true;
  }
  check(`guard rejects a re-added ${name}`, threw);
}

// 2. hazard on a name neither allowlisted nor secret-named: dropped by the builder,
//    and caught by the guard if it ever reaches an env.
const hidden = { HTTP_PROXY: "http://proxy-user:proxy-pass@proxy.invalid:3128" };
check(
  "builder drops a non-allowlisted credential URL (HTTP_PROXY)",
  !("HTTP_PROXY" in buildChildEnvironment(hidden, {})),
);
let forcedThrew = false;
try {
  assertNoInheritedSecrets(hidden, { HTTP_PROXY: hidden.HTTP_PROXY }, {});
} catch {
  forcedThrew = true;
}
check("guard rejects a forced non-allowlisted credential URL", forcedThrew);

// 3. a password in a URL QUERY STRING rather than userinfo.
const queryCredential = "https://hooks.invalid/x?password=hunter2";
check(
  "userinfo detector does not see a query-string password",
  urlUserinfo(queryCredential) === null,
  `describeAmbientHazard=${JSON.stringify(describeAmbientHazard("WEBHOOK_ENDPOINT", queryCredential))}`,
);
check(
  "builder drops a non-allowlisted query-string credential",
  !("WEBHOOK_ENDPOINT" in buildChildEnvironment({ WEBHOOK_ENDPOINT: queryCredential }, {})),
);
// The evasion only becomes reachable if the value rides an ALLOWLISTED name.
const allowlistedQueryCredential = {
  XDG_CACHE_HOME: queryCredential,
};
let queryThrew = false;
try {
  assertNoInheritedSecrets(
    allowlistedQueryCredential,
    buildChildEnvironment(allowlistedQueryCredential, {}),
    {},
  );
} catch {
  queryThrew = true;
}
check(
  "guard catches a query-string credential on an allowlisted name",
  queryThrew,
  "expected to be a residual gap (no allowlisted name is URL-valued by contract)",
);

// 4. poisoned PATH: the documented residual. Must pass through, and must not throw.
const poisonedPath = { PATH: "/tmp/evil-bin:/usr/bin:/bin" };
const pathEnv = buildChildEnvironment(poisonedPath, {});
let pathThrew = false;
try {
  assertNoInheritedSecrets(poisonedPath, pathEnv, {});
} catch {
  pathThrew = true;
}
check("PATH is inherited (documented residual)", pathEnv.PATH === poisonedPath.PATH);
check("guard does not (and cannot) flag a poisoned PATH", !pathThrew);
check(
  "every other allowlisted name is non-URL, non-flag plumbing",
  ["HOME", "TMPDIR", "LANG", "XDG_CONFIG_HOME"].every(
    (name) => !describeAmbientHazard(name, "ordinary value"),
  ),
);

// 5. the hazard scan reports each vector with a reason.
const hazards = scanAmbientHazards({
  NODE_OPTIONS: "--require /tmp/x.cjs",
  DOCKER_HOST: "tcp://u:p@h:2376",
  HTTP_PROXY: "http://u:p@proxy:3128",
  WEBHOOK_ENDPOINT: queryCredential,
  PATH: "/usr/bin",
});
console.log("scanAmbientHazards:", JSON.stringify(hazards, null, 0));
check(
  "hazard scan names NODE_OPTIONS/DOCKER_HOST/HTTP_PROXY but not the query-string URL or PATH",
  hazards.length === 3 &&
    hazards.some((h) => h.name === "NODE_OPTIONS") &&
    hazards.some((h) => h.name === "DOCKER_HOST") &&
    hazards.some((h) => h.name === "HTTP_PROXY") &&
    !hazards.some((h) => h.name === "WEBHOOK_ENDPOINT") &&
    !hazards.some((h) => h.name === "PATH"),
);

// 6. fingerprint stability and sensitivity.
const secrets = smokeSecrets();
const envA = { PUBLIC_ACCESS_SECRET: secrets.publicAccessSecret, ACCESS_TOKEN_SECRET: secrets.accessTokenSecret, REFRESH_TOKEN_PEPPER: secrets.refreshPepper, DATABASE_URL: "postgres://test:test@localhost:1111/test" };
const envB = { ...envA, DATABASE_URL: "postgres://test:test@localhost:9999/test", REDIS_URL: "redis://localhost:9999" };
check(
  "fingerprint identical for two runs with different ephemeral ports",
  fingerprintDeterministicSecrets(envA) === fingerprintDeterministicSecrets(envB),
  fingerprintDeterministicSecrets(envA),
);
check(
  "fingerprint changes when a deterministic secret changes",
  fingerprintDeterministicSecrets(envA) !==
    fingerprintDeterministicSecrets({ ...envA, ACCESS_TOKEN_SECRET: "different" }),
);
check(
  "fingerprint of a secret-less child is defined",
  /^[0-9a-f]{16}$/.test(fingerprintDeterministicSecrets({ PATH: "/usr/bin" })),
);

// 7. credential redaction of the recorded plumbing.
const redactionCases = [
  ["redis://user:secret@host:6379", "must redact user:password"],
  ["redis://:onlypassword@host:6379", "must redact password-only userinfo"],
  ["redis://user:p%40ss@host:6379", "must redact percent-encoded password"],
  ["redis://user@host:6379", "must redact username-only userinfo"],
  ["https://host/x?password=hunter2", "query-string password (documented gap)"],
];
for (const [value, label] of redactionCases) {
  const redacted = redactCredentials(value);
  const leaked = urlUserinfo(value) !== null && redacted === value;
  console.log(`${leaked ? "COUNTEREXAMPLE" : "note    "} redactCredentials(${value}) = ${redacted}  [${label}]`);
  if (leaked) failures++;
}

console.log(`\nreviewer adversarial env failures: ${failures} (excluding the two labelled notes/residuals)`);
process.exitCode = failures > 0 ? 1 : 0;
