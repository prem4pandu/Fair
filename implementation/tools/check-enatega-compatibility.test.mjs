import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { audit } from "./check-enatega-compatibility.mjs";

function fixture(
  t,
  source,
  schema = "type Query { viewer: User } type User { id: ID!, child: User } type Mutation { save: User }",
) {
  const root = mkdtempSync(join(tmpdir(), "fair-compatibility-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const directory of ["source/app", "contracts", "services/api/src"])
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
  const run = () =>
    audit(join(root, "source"), join(root, "contracts"), ["app"]);
  run.root = root;
  return run;
}

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
    "query { viewer { " + "child { ".repeat(8) + "id" + " }".repeat(8) + " } }";
  const definitions = Array.from(
    { length: 11 },
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

test("16KB query-only JSON is a minimum bound and oversized source fails", (t) => {
  const result = fixture(
    t,
    "const a = gql`query { viewer { " + "x".repeat(17000) + ": id } }`;",
  )();
  assert.equal(result.serverLimits.httpBodyBytes, 16384);
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
  const original = readFileSync(serverPath, "utf8");
  writeFileSync(serverPath, original.replace('limit: "16kb"', 'limit: "8kb"'));
  assert.equal(run().staticCompatibility, "FAIL");
  rmSync(serverPath);
  assert.equal(run().staticCompatibility, "FAIL");
  assert.equal(
    audit(join(run.root, "source"), join(run.root, "contracts"), [])
      .staticCompatibility,
    "FAIL",
  );
});
