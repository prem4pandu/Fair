import assert from "node:assert/strict";
import { test } from "node:test";
import { approvalState, releasePresentation } from "./gate-approval.mjs";

const gate = { approvals: ["lead", "reviewer-QA", "reviewer-security"] };
const run = (overrides = {}) => ({
  passed: true,
  finishedAt: "2026-10-09T10:00:00.000Z",
  commit: "abc123",
  recordedBy: "recorder@example.com",
  approvals: ["lead", "reviewer-QA", "reviewer-security"],
  approvalRecords: [
    ["lead", "lead@example.com"],
    ["reviewer-QA", "qa@example.com"],
    ["reviewer-security", "security@example.com"],
  ].map(([role, reviewer]) => ({
    role,
    reviewer,
    at: "2026-10-09T10:01:00.000Z",
    runFinishedAt: "2026-10-09T10:00:00.000Z",
    commit: "abc123",
  })),
  ...overrides,
});

test("approves only complete independent records for the exact run and commit", () => {
  assert.equal(approvalState(gate, run()).approved, true);
});

test("fails closed for forged summaries and incomplete records", () => {
  const candidate = run({ approvalRecords: run().approvalRecords.slice(0, 2) });
  const state = approvalState(gate, candidate);
  assert.equal(state.approved, false);
  assert.match(state.invalid.join(" "), /summary disagrees/);
  assert.deepEqual(state.missing, ["reviewer-security"]);
});

test("rejects duplicate normalized reviewers, recorder self-approval and stale stamps", () => {
  for (const approvalRecords of [
    run().approvalRecords.map((record, index) =>
      index === 1 ? { ...record, reviewer: "Lead <LEAD@example.com>" } : record,
    ),
    run().approvalRecords.map((record, index) =>
      index === 0
        ? { ...record, reviewer: "Recorder <recorder@example.com>" }
        : record,
    ),
    run().approvalRecords.map((record, index) =>
      index === 0
        ? { ...record, runFinishedAt: "2026-10-09T09:00:00.000Z" }
        : record,
    ),
    run().approvalRecords.map((record, index) =>
      index === 0 ? { ...record, commit: "other" } : record,
    ),
  ])
    assert.equal(approvalState(gate, run({ approvalRecords })).approved, false);
});

test("rejects missing, malformed and pre-run approval timestamps", () => {
  for (const at of [undefined, "not-a-date", "2026-10-09T09:59:59.999Z"]) {
    const approvalRecords = run().approvalRecords.map((record, index) =>
      index === 0 ? { ...record, at } : record,
    );
    assert.equal(approvalState(gate, run({ approvalRecords })).approved, false);
  }
});

test("rejects a legacy commit author self-approval", () => {
  const candidate = run({ recordedBy: undefined });
  candidate.approvalRecords[0].reviewer = "Author <author@example.com>";
  assert.equal(
    approvalState(gate, candidate, {
      commitAuthor: () => "author@example.com",
    }).approved,
    false,
  );
});

test("release presentation has truthful approved and unapproved HTML/status values", () => {
  assert.deepEqual(releasePresentation(true), {
    badge: "COMPLETE",
    release: "APPROVED",
    text: "G5 is passed and closed by every required independent approval.",
  });
  assert.deepEqual(releasePresentation(false), {
    badge: "IN PROGRESS",
    release: "NOT_APPROVED",
    text: "G5 is not closed by a passed run and every required independent approval.",
  });
});
