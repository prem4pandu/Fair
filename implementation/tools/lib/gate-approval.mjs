// Shared approval arithmetic for recorded gate runs.
//
// A gate's *required* reviewer roles are declared in docs/ROADMAP.json; the
// roles actually signed off live in docs/GATES.json. Both status generators and
// tools/approve-gate.mjs read this module so they can never disagree about
// whether a gate is closed. The rule from docs/ROADMAP.md is that commands
// passing is only half of a gate: every required independent reviewer must be
// recorded too.

/** Reviewer roles a gate definition demands, e.g. ["lead","reviewer-QA"]. */
export const requiredRoles = (gate) => [...(gate?.approvals ?? [])];

/** Reviewer roles recorded against a run. */
export const recordedRoles = (run) => [...(run?.approvals ?? [])];

/**
 * Derive a run's approval state against its gate definition.
 *
 * `approved` is deliberately strict: a gate with three required reviewers is
 * not closed by one signature. A gate that declares no reviewers at all is
 * never approved either — that is a plan defect, not an open door.
 */
export function approvalState(gate, run) {
  const required = requiredRoles(gate);
  const recorded = recordedRoles(run);
  const missing = required.filter((role) => !recorded.includes(role));
  const unexpected = recorded.filter((role) => !required.includes(role));
  return {
    required,
    recorded,
    missing,
    unexpected,
    passed: Boolean(run?.passed),
    approved:
      Boolean(run?.passed) &&
      required.length > 0 &&
      missing.length === 0 &&
      unexpected.length === 0,
  };
}

/** The run a gate is judged by: its last complete (non-partial) run. */
export const judgedRun = (entry) => {
  const latest = entry?.latest ?? entry?.runs?.at(-1);
  return latest?.finishedAt ? latest : null;
};

/**
 * Normalized reviewer identity, for comparing people rather than spellings.
 *
 * `A N Other <an@example.com>` and `an@example.com` are the same reviewer, so
 * both collapse to the address. Without this, the no-self-approval and
 * role-independence rules are defeated by changing how you type your name.
 */
export const identity = (value) => {
  const text = String(value ?? "").trim();
  const email = text.match(/<([^>]+)>/)?.[1] ?? text;
  return email.trim().toLowerCase();
};
