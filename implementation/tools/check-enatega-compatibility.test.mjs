import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { audit } from "./check-enatega-compatibility.mjs";

const implementationRoot = fileURLToPath(new URL("..", import.meta.url));
const toolPath = fileURLToPath(
  new URL("./check-enatega-compatibility.mjs", import.meta.url),
);

// The CLI audits the six pinned app names against the real backend SDL, so the
// CLI fixture keeps real contracts/limits but a tiny throwaway source tree whose
// only sites are valid against that SDL. That makes the computed report PASS and
// keeps these tests focused on write/diff semantics instead of SDL drift.
const cliApps = [
  "enatega-multivendor-web",
  "enatega-multivendor-admin",
  "enatega-singlevendor-admin",
  "enatega-multivendor-app",
  "enatega-multivendor-store",
  "enatega-multivendor-rider",
];

function cliFixture(t) {
  const root = mkdtempSync(join(tmpdir(), "fair-compatibility-cli-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const app of cliApps) {
    mkdirSync(join(root, "source", app), { recursive: true });
    writeFileSync(
      join(root, "source", app, "operations.ts"),
      "const doc = gql`query { __typename }`;",
    );
  }
  const report = join(root, "report.json");
  const run = (extra = []) =>
    spawnSync(
      process.execPath,
      [
        toolPath,
        join(root, "source"),
        join(implementationRoot, "contracts"),
        report,
        ...extra,
      ],
      {
        cwd: implementationRoot,
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
      },
    );
  return { root, report, run };
}

const digest = (path) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");

test("CLI without --check regenerates and writes the report", (t) => {
  const fixture = cliFixture(t);
  assert.equal(existsSync(fixture.report), false);
  const result = fixture.run();
  assert.equal(result.status, 0);
  assert.equal(existsSync(fixture.report), true);
  const report = JSON.parse(readFileSync(fixture.report, "utf8"));
  assert.equal(report.staticCompatibility, "PASS");
  assert.equal(report.apps.length, 6);
});

test("--check on an identical report exits 0 and leaves the file byte-identical", (t) => {
  const fixture = cliFixture(t);
  assert.equal(fixture.run().status, 0);
  const before = digest(fixture.report);
  const result = fixture.run(["--check"]);
  assert.equal(result.status, 0);
  assert.equal(digest(fixture.report), before);
  assert.equal(
    /DRIFT|missing/i.test(result.stderr),
    false,
    `unexpected stderr: ${result.stderr}`,
  );
  assert.match(result.stdout, /"status":"PASS"/);
});

test("--check detects a mutated on-disk report, names the drift and never writes", (t) => {
  const fixture = cliFixture(t);
  assert.equal(fixture.run().status, 0);
  const report = JSON.parse(readFileSync(fixture.report, "utf8"));
  report.summary.documents += 1;
  report.apps[0].documents[0].status = "DELIBERATELY_CORRUPTED";
  writeFileSync(fixture.report, JSON.stringify(report, null, 2));
  const before = digest(fixture.report);
  const result = fixture.run(["--check"]);
  assert.notEqual(result.status, 0);
  assert.equal(
    digest(fixture.report),
    before,
    "the report file must not be rewritten",
  );
  assert.match(result.stderr, /DRIFT DETECTED/);
  assert.match(result.stderr, /summary: differs/);
  assert.match(result.stderr, /apps: 1 of 6 app record\(s\) differ/);
  assert.match(result.stderr, /1 of \d+ document record\(s\) differ/);
});

test("--check fails when the report is missing and does not create it", (t) => {
  const fixture = cliFixture(t);
  const result = fixture.run(["--check"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /missing/);
  assert.equal(existsSync(fixture.report), false);
});

test("usage text documents that --check never writes the report", () => {
  const result = spawnSync(process.execPath, [toolPath], {
    cwd: implementationRoot,
    encoding: "utf8",
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /never writes OUTPUT/);
  assert.match(result.stderr, /Without --check/);
});

function fixture(
  t,
  source,
  schema = "type Query { viewer: User } type User { id: ID!, child: User } type Mutation { save: User }",
  options = {},
) {
  const root = mkdtempSync(join(tmpdir(), "fair-compatibility-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const directory of [
    "source/app",
    "contracts",
    "services/api/src/kernel",
  ])
    mkdirSync(join(root, directory), { recursive: true });
  writeFileSync(join(root, "source/app/operations.ts"), source);
  writeFileSync(join(root, "contracts/schema.graphql"), schema);
  writeFileSync(
    join(root, "services/api/src/app.ts"),
    readFileSync(
      new URL("../services/api/src/app.ts", import.meta.url),
      "utf8",
    ),
  );
  writeFileSync(
    join(root, "services/api/src/kernel/limits.ts"),
    readFileSync(
      new URL("../services/api/src/kernel/limits.ts", import.meta.url),
      "utf8",
    ),
  );
  writeFileSync(
    join(root, "services/api/src/config.ts"),
    'const schema = z.object({ GRAPHQL_BODY_LIMIT: z.string().default("1mb") });',
  );
  const run = (auditOptions = options.audit) =>
    audit(join(root, "source"), join(root, "contracts"), ["app"], auditOptions);
  run.root = root;
  return run;
}

test("reads boundedOperation from services/api/src/kernel/limits.ts when present", (t) => {
  const run = fixture(t, "const doc = gql`query { viewer { id } }`;");
  const kernel = join(run.root, "services/api/src/kernel");
  mkdirSync(kernel, { recursive: true });
  writeFileSync(
    join(kernel, "limits.ts"),
    `import { GraphQLError, Kind } from "graphql";
export const LIMITS = { fields: 1 } as const;
export const boundedOperation = (context) => ({
  Document(node) {
    let fields = 0;
    const visit = (value) => {
      if (value?.kind === Kind.FIELD) fields++;
      for (const child of value?.selectionSet?.selections ?? []) visit(child);
    };
    for (const definition of node.definitions) visit(definition);
    if (fields > LIMITS.fields)
      context.reportError(new GraphQLError("Operation exceeds allowed limits"));
  },
});`,
  );
  const report = run();
  assert.equal(report.serverLimits.source, "services/api/src/kernel/limits.ts");
  assert.deepEqual(report.apps[0].documents[0].backendOperationLimits, [
    "Operation exceeds allowed limits",
  ]);
});

test("multivendor scope ignores documents whose only missing roots are L12", (t) => {
  const run = fixture(t, "const doc = gql`query { singleVendorDiscovery }`;");
  const report = run({
    scope: "multivendor",
    lanes: { "query.singleVendorDiscovery": "L12" },
  });
  assert.equal(report.apps[0].documents[0].status, "OUT_OF_SCOPE");
  assert.equal(report.staticCompatibility, "PASS");
});

test("reads the configured GraphQL body-limit default", (t) => {
  const run = fixture(t, "const doc = gql`query { viewer { id } }`;");
  writeFileSync(
    join(run.root, "services/api/src/config.ts"),
    'const schema = z.object({ GRAPHQL_BODY_LIMIT: z.string().default("2mb") });',
  );
  assert.equal(run().serverLimits.httpBodyBytes, 2 * 1024 * 1024);
});

test("multivendor scope still fails documents with any in-scope missing root", (t) => {
  const run = fixture(
    t,
    "const doc = gql`query { singleVendorDiscovery multivendorDiscovery }`;",
  );
  const report = run({
    scope: "multivendor",
    lanes: {
      "query.singleVendorDiscovery": "L12",
      "query.multivendorDiscovery": "L3",
    },
  });
  assert.equal(report.apps[0].documents[0].status, "INVALID");
  assert.equal(report.staticCompatibility, "FAIL");
});

test("valid static fragments, aliases and multiline comments validate deterministically", (t) => {
  const run = fixture(
    t,
    "const doc = gql`# comment\nquery UserQuery { person: viewer { ...Details } } fragment Details on User { id }`;",
  );
  const first = run();
  assert.deepEqual(first, run());
  assert.equal(first.staticCompatibility, "PASS");
  assert.deepEqual(first.apps[0].documents[0].operations[0].roots, ["viewer"]);
});

test("a standalone shared fragment export is a valid static document", (t) => {
  const report = fixture(
    t,
    "export const DETAILS = gql`fragment Details on User { id child { id } }`;",
  )();
  const document = report.apps[0].documents[0];
  assert.deepEqual(document.operations, []);
  assert.deepEqual(document.errors, []);
  assert.deepEqual(document.missingRoots, []);
  assert.equal(document.status, "VALID_STATIC_DOCUMENT");
});

test("a fragment-only document selecting an absent field still fails", (t) => {
  const report = fixture(
    t,
    "export const DETAILS = gql`fragment Details on User { unavailable }`;",
  )();
  const document = report.apps[0].documents[0];
  assert.equal(document.status, "INVALID");
  assert.ok(
    document.errors.some((error) =>
      error.message.includes("Cannot query field"),
    ),
  );
  assert.equal(report.staticCompatibility, "FAIL");
});

test("a fragment-only document on an unknown type condition still fails", (t) => {
  const report = fixture(
    t,
    "export const DETAILS = gql`fragment Details on Absent { id }`;",
  )();
  const document = report.apps[0].documents[0];
  assert.equal(document.status, "INVALID");
  assert.ok(
    document.errors.some((error) => error.message.includes("Unknown type")),
  );
  assert.equal(report.staticCompatibility, "FAIL");
});

test("an unused fragment beside an operation is still rejected", (t) => {
  const report = fixture(
    t,
    "const doc = gql`query Q { viewer { ...Used } } fragment Used on User { id } fragment Unused on User { id }`;",
  )();
  const document = report.apps[0].documents[0];
  assert.equal(document.status, "INVALID");
  assert.ok(
    document.errors.some((error) => error.message.includes("never used")),
  );
  assert.equal(report.staticCompatibility, "FAIL");
});

test("field, argument and variable-type mismatches fail beyond root-name matching", (t) => {
  const result = fixture(
    t,
    "const doc = `query UserQuery($id: String!) { viewer(id: $id) { unavailable } }`;",
  )();
  const doc = result.apps[0].documents[0];
  assert.equal(result.staticCompatibility, "FAIL");
  assert.deepEqual(doc.missingRoots, []);
  assert.ok(doc.errors.some((e) => e.message.includes("Unknown argument")));
  assert.ok(doc.errors.some((e) => e.message.includes("unavailable")));
});

test("absent Subscription type and fragment-wrapped missing roots cannot pass", (t) => {
  const result = fixture(
    t,
    "const a = `subscription { orderStatusChanged }`; const b = `query { ...Root } fragment Root on Query { missing }`;",
  )();
  assert.equal(result.apps[0].validDocuments, 0);
  assert.deepEqual(result.summary.missingRoots, [
    "query.missing",
    "subscription.orderStatusChanged",
  ]);
});

test("interpolated documents and imported gql arguments remain unresolved", (t) => {
  const result = fixture(
    t,
    "const a = gql`query { viewer { ${fields} } }`; const b = gql(imported); const c = `query { viewer { ${fields} } }`;",
  )();
  assert.equal(result.summary.unresolvedDocuments, 3);
  assert.equal(result.staticCompatibility, "FAIL");
});

test("missing fragment imports and malformed documents fail without execution", (t) => {
  const result = fixture(
    t,
    'const a = gql`query { viewer { ...Imported } }`; const b = gql`query {`; throw new Error("must never execute");',
  )();
  assert.deepEqual(
    result.apps[0].documents.map((d) => d.status),
    ["INVALID", "PARSE_ERROR"],
  );
});

test("actual backend rule rejects multiple mutation roots and excessive field count", (t) => {
  const result = fixture(
    t,
    "const a = gql`mutation { one: save { id } two: save { id } }`; const b = gql`query { " +
      Array.from({ length: 101 }, (_, i) => `v${i}: viewer { id }`).join(" ") +
      " }`;",
  )();
  assert.equal(result.apps[0].validDocuments, 2);
  assert.equal(result.staticCompatibility, "FAIL");
  for (const doc of result.apps[0].documents)
    assert.deepEqual(doc.backendOperationLimits, [
      "Operation exceeds allowed limits",
    ]);
});

test("actual backend rule checks depth and total definitions", (t) => {
  const deep =
    "query { viewer { " +
    "child { ".repeat(15) +
    "id" +
    " }".repeat(15) +
    " } }";
  const definitions = Array.from(
    { length: 61 },
    (_, i) => `query Q${i} { viewer { id } }`,
  ).join("\n");
  const result = fixture(
    t,
    `const a = gql\`${deep}\`; const b = gql\`${definitions}\`;`,
  )();
  for (const doc of result.apps[0].documents)
    assert.deepEqual(doc.backendOperationLimits, [
      "Operation exceeds allowed limits",
    ]);
});

test("configured query-only JSON limit is a minimum bound and oversized source fails", (t) => {
  const result = fixture(
    t,
    "const a = gql`query { viewer { " +
      "x".repeat(1024 * 1024 + 1) +
      ": id } }`;",
  )();
  assert.equal(result.serverLimits.httpBodyBytes, 1024 * 1024);
  assert.equal(result.apps[0].documents[0].minimumHttpBodyExceedsLimit, true);
  assert.equal(result.staticCompatibility, "FAIL");
});

test("empty source and TypeScript parse errors fail closed", (t) => {
  assert.equal(
    fixture(
      t,
      'const ordinary = "hello"; const operation = "query"; const log = "mutation variables: create user";',
    )().staticCompatibility,
    "FAIL",
  );
  const result = fixture(
    t,
    "const doc = gql`query { viewer { id } }`; const broken = ;",
  )();
  assert.ok(result.apps[0].sourceErrors.length);
  assert.equal(result.staticCompatibility, "FAIL");
});

test("absent server source, unknown body limit and empty app sets cannot pass", (t) => {
  const run = fixture(t, "const doc = gql`query { viewer { id } }`;");
  const serverPath = join(run.root, "services/api/src/app.ts");
  const configPath = join(run.root, "services/api/src/config.ts");
  rmSync(configPath);
  assert.equal(run().staticCompatibility, "FAIL");
  rmSync(serverPath);
  rmSync(join(run.root, "services/api/src/kernel/limits.ts"));
  assert.equal(run().staticCompatibility, "FAIL");
  assert.equal(
    audit(join(run.root, "source"), join(run.root, "contracts"), [])
      .staticCompatibility,
    "FAIL",
  );
});

test("a supplied resolution set is the whole audit unless reconciliation is requested", (t) => {
  const run = fixture(
    t,
    "const a = gql`query { viewer { id } }`;\nconst b = gql`query { viewer { child { id } } }`;",
  );
  const report = run({
    documents: [
      {
        app: "app",
        file: "operations.ts",
        line: 1,
        text: "query { viewer { id } }",
        resolved: true,
      },
    ],
  });
  assert.equal(report.apps[0].documents.length, 1);
  assert.equal(report.apps[0].documents[0].status, "VALID_STATIC_DOCUMENT");
});

test("reconciliation still audits a static site the resolver did not cover", (t) => {
  const run = fixture(
    t,
    "const a = gql`query { viewer { id } }`;\nconst b = gql`query { viewer { child { id } } }`;",
  );
  const report = run({
    documents: [
      {
        app: "app",
        file: "operations.ts",
        line: 1,
        text: "query { viewer { id } }",
        resolved: true,
      },
    ],
    reconcileUncoveredSites: true,
  });
  assert.equal(report.apps[0].documents.length, 2);
  assert.equal(report.apps[0].documents[1].line, 2);
  assert.equal(report.apps[0].documents[1].status, "VALID_STATIC_DOCUMENT");
});

test("reconciliation reports a dynamic site the resolver did not cover instead of dropping it", (t) => {
  const run = fixture(
    t,
    "const a = gql`query { viewer { id } }`;\nconst b = gql`query { viewer { child { id ${field} } } }`;",
  );
  const report = run({
    documents: [
      {
        app: "app",
        file: "operations.ts",
        line: 1,
        text: "query { viewer { id } }",
        resolved: true,
      },
    ],
    reconcileUncoveredSites: true,
  });
  const uncovered = report.apps[0].documents.filter(
    (document) => document.status === "UNRESOLVED",
  );
  assert.equal(report.apps[0].documents.length, 2);
  assert.equal(uncovered.length, 1);
  assert.equal(uncovered[0].line, 2);
  assert.match(uncovered[0].errors[0].message, /import\/interpolation/);
});
