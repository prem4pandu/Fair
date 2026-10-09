import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ApprovalError,
  applyApproval,
  listApprovalState,
} from "./approve-gate.mjs";
import { approvalState } from "./lib/gate-approval.mjs";

const gate = { id: "GX", approvals: ["lead", "reviewer-QA"] };
const head = "c".repeat(40);

/** A clean, complete, passing run — the only shape that may be approved. */
function registryWith(overrides = {}) {
  const run = {
    gate: "GX",
    commit: head,
    dirty: false,
    recordedBy: "runner@example.com",
    startedAt: "2026-01-01T00:00:00.000Z",
    finishedAt: "2026-01-01T00:10:00.000Z",
    passed: true,
    partial: false,
    commands: [],
    approvals: [],
    reviewer: null,
    approved: false,
    ...overrides,
  };
  return {
    schemaVersion: 1,
    gates: {
      GX: {
        gate: "GX",
        runs: [run],
        latest: {
          commit: run.commit,
          dirty: run.dirty,
          finishedAt: run.finishedAt,
          passed: run.passed,
          approvals: [],
          approved: false,
          commands: [],
        },
      },
    },
  };
}

const approve = (registry, options) =>
  applyApproval({
    registry,
    gate,
    head,
    now: () => "2026-02-02T00:00:00.000Z",
    ...options,
  });

test("a gate closes only when every required reviewer role is recorded", () => {
  const registry = registryWith();

  const first = approve(registry, {
    role: "lead",
    reviewer: "Lead <lead@example.com>",
  });
  assert.deepEqual(first.state.recorded, ["lead"]);
  assert.deepEqual(first.state.missing, ["reviewer-QA"]);
  assert.equal(
    first.state.approved,
    false,
    "one of two signatures is not closed",
  );

  const second = approve(registry, {
    role: "reviewer-QA",
    reviewer: "QA <qa@example.com>",
  });
  assert.equal(second.state.approved, true);
  assert.deepEqual(second.state.missing, []);

  // The run and the headline must agree, since the generators read `latest`
  // while the evidence lives on the run.
  const entry = registry.gates.GX;
  assert.deepEqual(entry.latest.approvals, ["lead", "reviewer-QA"]);
  assert.deepEqual(entry.runs[0].approvals, ["lead", "reviewer-QA"]);
  assert.equal(entry.latest.approved, true);
  assert.equal(entry.runs[0].approved, true);
  assert.equal(approvalState(gate, entry.latest).approved, true);
  assert.equal(entry.runs[0].approvalRecords.length, 2);
  assert.equal(entry.runs[0].approvalRecords[0].role, "lead");
  assert.equal(entry.runs[0].approvalRecords[0].at, "2026-02-02T00:00:00.000Z");
});

test("a failing, dirty, partial or absent run cannot be approved", () => {
  const signature = { role: "lead", reviewer: "Lead <lead@example.com>" };

  assert.throws(
    () => approve(registryWith({ passed: false }), signature),
    (error) => error instanceof ApprovalError && /FAILED/.test(error.message),
  );
  assert.throws(
    () => approve(registryWith({ dirty: true }), signature),
    /dirty tree/,
  );
  assert.throws(
    () => approve({ schemaVersion: 1, gates: {} }, signature),
    /no complete recorded run/,
  );

  // A filtered run is evidence for the commands it ran, never a gate result.
  const partial = registryWith();
  partial.gates.GX.runs[0].partial = true;
  assert.throws(() => approve(partial, signature), /no complete run matches/);
});

test("self-approval is refused, by stamp and by commit author", () => {
  assert.throws(
    () =>
      approve(registryWith(), {
        role: "lead",
        reviewer: "  Runner@Example.com  ",
      }),
    /no self-approval/,
    "identity comparison ignores case and padding",
  );

  // Runs recorded before the recordedBy stamp existed fall back to the commit
  // author, so historical runs cannot be quietly self-approved either.
  const legacy = registryWith({ recordedBy: undefined });
  assert.throws(
    () =>
      applyApproval({
        registry: legacy,
        gate,
        head,
        role: "lead",
        reviewer: "author@example.com",
        commitAuthor: () => "author@example.com",
      }),
    /no self-approval/,
  );
});

test("reviewer roles must be independent identities", () => {
  const registry = registryWith();
  approve(registry, { role: "lead", reviewer: "One <one@example.com>" });
  assert.throws(
    () =>
      approve(registry, { role: "reviewer-QA", reviewer: "one@example.com" }),
    /must be independent people/,
  );
});

test("unknown roles, undeclared gates and silent re-signing are refused", () => {
  assert.throws(
    () =>
      approve(registryWith(), {
        role: "reviewer-SEC",
        reviewer: "Sec <sec@example.com>",
      }),
    /does not require role/,
  );
  assert.throws(
    () =>
      applyApproval({
        registry: registryWith(),
        gate: { id: "GX", approvals: [] },
        head,
        role: "lead",
        reviewer: "Lead <lead@example.com>",
      }),
    /declares no reviewer roles/,
  );
  assert.throws(
    () => approve(registryWith(), { role: "lead", reviewer: "   " }),
    /--reviewer must name/,
  );

  const registry = registryWith();
  approve(registry, { role: "lead", reviewer: "One <one@example.com>" });
  assert.throws(
    () =>
      approve(registry, { role: "lead", reviewer: "Two <two@example.com>" }),
    /already approved by/,
  );
  const replaced = approve(registry, {
    role: "lead",
    reviewer: "Two <two@example.com>",
    replace: true,
  });
  assert.deepEqual(replaced.state.recorded, ["lead"]);
  assert.equal(registry.gates.GX.runs[0].approvalRecords.length, 1);
  assert.match(registry.gates.GX.runs[0].reviewer, /two@example\.com/);
});

test("approving a tree older than HEAD is deliberate, not accidental", () => {
  const stale = registryWith({ commit: "a".repeat(40) });
  const signature = { role: "lead", reviewer: "Lead <lead@example.com>" };
  assert.throws(() => approve(stale, signature), /--allow-stale/);

  const { record } = approve(stale, { ...signature, allowStale: true });
  assert.equal(record.approvedStaleTree, true);
  assert.equal(record.commit, "a".repeat(40));
  assert.equal(record.headAtApproval, head);
});

test("list state cannot hide recorder self-approval in a projected latest summary", () => {
  const definition = { id: "GX", approvals: ["owner"] };
  const registry = registryWith();
  const run = registry.gates.GX.runs[0];
  const record = {
    role: "owner",
    reviewer: "Runner <runner@example.com>",
    at: "2026-01-01T00:11:00.000Z",
    runFinishedAt: run.finishedAt,
    commit: run.commit,
  };
  run.approvals = ["owner"];
  run.approvalRecords = [record];
  registry.gates.GX.latest = {
    ...registry.gates.GX.latest,
    approvals: ["owner"],
    approvalRecords: [record],
  };

  const state = listApprovalState(
    definition,
    registry.gates.GX,
    () => "different-author@example.com",
  );
  assert.equal(state.approved, false);
  assert.match(state.invalid.join(" "), /recorded or authored the run/);
});

test("list state ignores approval evidence forged only in latest", () => {
  const definition = { id: "GX", approvals: ["owner"] };
  const registry = registryWith();
  const run = registry.gates.GX.runs[0];
  registry.gates.GX.latest = {
    ...registry.gates.GX.latest,
    approvals: ["owner"],
    approvalRecords: [
      {
        role: "owner",
        reviewer: "reviewer@example.com",
        at: "2026-01-01T00:11:00.000Z",
        runFinishedAt: run.finishedAt,
        commit: run.commit,
      },
    ],
  };

  const state = listApprovalState(definition, registry.gates.GX);
  assert.equal(state.approved, false);
  assert.deepEqual(state.recorded, []);
  assert.deepEqual(state.missing, ["owner"]);
});
