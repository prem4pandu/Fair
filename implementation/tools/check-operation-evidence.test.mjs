import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  checkOperationEvidence,
  checkOperationSchema,
} from "./check-operation-evidence.mjs";
const inventory = {
  total: 1,
  operations: [{ type: "query", name: "orders", apps: ["web", "app"] }],
};
const check = () => ({
  path: "tests/orders.test.mjs",
  command: "node --test tests/orders.test.mjs",
  result: {
    status: "passed",
    exitCode: 0,
    evidenceFiles: ["results/orders.log"],
  },
});
const evidence = () => ({
  records: [
    {
      type: "query",
      name: "orders",
      tests: {
        unit: [check()],
        integration: [check()],
        playwright: [check()],
        device: [check()],
      },
    },
  ],
});
const run = (e = evidence(), i = inventory) =>
  checkOperationEvidence(i, e, {
    inspectFile: () => true,
    readTestFile: () => "query:orders passed",
  });
test("inventory without evidence is explicitly uncovered", () => {
  const result = run({ records: [] });
  assert.equal(result.complete, false);
  assert.equal(result.uncovered.length, 1);
  assert.deepEqual(result.errors, []);
});
test("complete evidence covers exact operation and every applicable gate", () =>
  assert.equal(run().complete, true));
test("missing integration, browser and device gates remain uncovered", () => {
  const e = evidence();
  e.records[0].tests = { unit: [check()] };
  assert.deepEqual(run(e).uncovered[0].missing, [
    "integration",
    "device",
    "web",
  ]);
});
test("duplicates and unexpected operations fail", () => {
  const e = evidence();
  e.records.push(e.records[0], { type: "mutation", name: "orders" });
  const r = run(e);
  assert.equal(r.complete, false);
  assert.match(r.errors.join("\n"), /Duplicate evidence/);
  assert.match(r.errors.join("\n"), /Unexpected operation/);
});
test("inventory duplicates and inconsistent totals fail", () => {
  const r = run(evidence(), {
    total: 9,
    operations: [inventory.operations[0], inventory.operations[0]],
  });
  assert.match(r.errors.join("\n"), /Duplicate inventory/);
  assert.match(r.errors.join("\n"), /total/);
});
test("test files and result artifacts must exist and contain data", () => {
  const r = checkOperationEvidence(inventory, evidence(), {
    inspectFile: () => false,
  });
  assert.equal(r.complete, false);
  assert.match(r.errors.join("\n"), /missing, empty or non-regular/);
});
test("a command alone or a failed result cannot pass", () => {
  for (const result of [
    undefined,
    { status: "passed", exitCode: 1, evidenceFiles: ["log"] },
    { status: "passed", exitCode: 0, evidenceFiles: [] },
  ]) {
    const e = evidence();
    e.records[0].tests.unit[0].result = result;
    assert.equal(run(e).complete, false);
    assert.ok(run(e).errors.length);
  }
});
test("missing command and malformed evidence fail", () => {
  const e = evidence();
  delete e.records[0].tests.unit[0].command;
  assert.equal(run(e).complete, false);
  assert.equal(run({}).complete, false);
});
test("web journey is accepted and mobile-only operations still require device evidence", () => {
  const e = evidence();
  e.records[0].tests.webJourney = e.records[0].tests.playwright;
  delete e.records[0].tests.playwright;
  assert.equal(run(e).complete, true);
  delete e.records[0].tests.device;
  assert.equal(
    run(e, {
      total: 1,
      operations: [{ ...inventory.operations[0], apps: ["rider"] }],
    }).complete,
    false,
  );
});
test("CLI default inventory is honest, strict mode fails, reports do not overwrite", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "operation-evidence-"));
  try {
    fs.writeFileSync(
      path.join(root, "inventory.json"),
      JSON.stringify(inventory),
    );
    const cli = (args) =>
      spawnSync(
        process.execPath,
        [
          fileURLToPath(
            new URL("./check-operation-evidence.mjs", import.meta.url),
          ),
          "--root",
          root,
          "--inventory",
          "inventory.json",
          ...args,
        ],
        { encoding: "utf8" },
      );
    const normal = cli([]);
    assert.equal(normal.status, 0);
    assert.equal(JSON.parse(normal.stdout).complete, false);
    assert.equal(cli(["--require-complete"]).status, 1);
    assert.equal(cli(["--require-schema"]).status, 1);
    assert.equal(cli(["--report", "report.json"]).status, 0);
    const before = fs.readFileSync(path.join(root, "report.json"), "utf8");
    assert.equal(cli(["--report", "report.json"]).status, 1);
    assert.equal(
      fs.readFileSync(path.join(root, "report.json"), "utf8"),
      before,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("schema readiness accepts implemented roots and explicit NOT_IMPLEMENTED fallbacks", () => {
  const homes = new Map([["query.orders", "L5-orders.graphql"]]);
  const implemented = new Set(["query.orders"]);
  assert.equal(
    checkOperationSchema(inventory, {
      homes,
      implemented,
      fallbackEnabled: false,
    }).ready,
    true,
  );
  implemented.clear();
  const fallback = checkOperationSchema(inventory, {
    homes,
    implemented,
    fallbackEnabled: true,
  });
  assert.equal(fallback.ready, true);
  assert.equal(fallback.explicitNotImplemented, 1);
});

test("schema readiness fails for missing SDL or an unwired fallback", () => {
  const missing = checkOperationSchema(inventory, {
    homes: new Map(),
    implemented: new Set(),
    fallbackEnabled: true,
  });
  assert.equal(missing.ready, false);
  assert.equal(missing.missing[0].reason, "SDL_MISSING");
  const unwired = checkOperationSchema(inventory, {
    homes: new Map([["query.orders", "L5-orders.graphql"]]),
    implemented: new Set(),
    fallbackEnabled: false,
  });
  assert.equal(unwired.ready, false);
  assert.equal(
    unwired.missing[0].reason,
    "NO_RESOLVER_OR_NOT_IMPLEMENTED_FALLBACK",
  );
});

test("the repository check rejects roots excluded from the active runtime", () => {
  const result = checkOperationSchema({
    total: 1,
    operations: [
      {
        type: "query",
        name: "adminConfiguration",
        apps: ["svadmin(sv)"],
      },
    ],
  });
  assert.equal(result.ready, false);
  assert.equal(result.missing[0].reason, "SDL_MISSING");
});

test("zero inventories, unsupported types, and missing or unknown apps cannot pass", () => {
  assert.equal(
    run({ records: [] }, { total: 0, operations: [] }).complete,
    false,
  );
  for (const apps of [undefined, [], ["unknown"], "web"]) {
    const r = run(evidence(), {
      total: 1,
      operations: [{ ...inventory.operations[0], apps }],
    });
    assert.equal(r.complete, false);
    assert.match(r.errors.join(" "), /apps|unknown app/);
  }
  const r = run(
    { records: [] },
    {
      total: 1,
      operations: [{ type: "invented", name: "orders", apps: ["web"] }],
    },
  );
  assert.match(r.errors.join(" "), /Unsupported operation type/);
});
test("unrelated or prefix-only test and artifact claims cannot pass", () => {
  for (const contents of [
    "query:other",
    "query:ordersExtra",
    "notquery:orders",
    "orders",
  ]) {
    const r = checkOperationEvidence(inventory, evidence(), {
      inspectFile: () => true,
      readTestFile: () => contents,
    });
    assert.equal(r.complete, false);
    assert.match(r.errors.join(" "), /no exact operation association/);
  }
  for (const contents of ["query.orders passed", "test query:orders passed"]) {
    assert.equal(
      checkOperationEvidence(inventory, evidence(), {
        inspectFile: () => true,
        readTestFile: () => contents,
      }).complete,
      true,
    );
  }
  const r = checkOperationEvidence(inventory, evidence(), {
    inspectFile: () => true,
    readTestFile: (file) =>
      file.endsWith(".log") ? "unrelated success" : "query:orders",
  });
  assert.equal(r.complete, false);
  assert.match(r.errors.join(" "), /result: no exact operation association/);
});
