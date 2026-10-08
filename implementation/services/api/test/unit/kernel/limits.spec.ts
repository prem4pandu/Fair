import { buildSchema, graphql, parse, validate } from "graphql";
import { describe, expect, it } from "vitest";
import { boundedOperation, LIMITS } from "../../../src/kernel/limits.js";
import { fillNotImplemented } from "../../../src/kernel/not-implemented.js";

const schema = buildSchema(`
  type Node { a: Int, child: Node }
  type Query { node: Node, ready: String }
  type Mutation { one: Int, two: Int }
  type Subscription { tick: Int }
`);

const errorsFor = (query: string) =>
  validate(schema, parse(query), [boundedOperation]);

describe("operation limits", () => {
  it("accepts documents within the limits", () => {
    expect(errorsFor("{ node { a child { a } } }")).toHaveLength(0);
  });

  it("rejects documents deeper than the depth limit", () => {
    const deep =
      "{ node " +
      "{ child ".repeat(LIMITS.depth) +
      "{ a }" +
      " }".repeat(LIMITS.depth) +
      " }";

    expect(errorsFor(deep)[0]?.message).toBe(
      "Operation exceeds allowed limits",
    );
  });

  it("rejects more than one mutation root", () => {
    expect(errorsFor("mutation { one two }")).toHaveLength(1);
  });

  it("rejects fragment cycles", () => {
    expect(
      errorsFor(
        "query { node { ...A } } fragment A on Node { child { ...B } } fragment B on Node { child { ...A } }",
      ).length,
    ).toBeGreaterThan(0);
  });

  it("enforces definition, field and alias limits", () => {
    const definitions = Array.from(
      { length: LIMITS.definitions + 1 },
      (_, index) => `query Q${index} { ready }`,
    ).join("\n");
    const fields = `{ ${Array.from(
      { length: LIMITS.fields + 1 },
      (_, index) => `f${index}: ready`,
    ).join(" ")} }`;
    const aliases = `{ ${Array.from(
      { length: LIMITS.aliases + 1 },
      (_, index) => `a${index}: ready`,
    ).join(" ")} }`;

    expect(errorsFor(definitions)).toHaveLength(1);
    expect(errorsFor(fields)).toHaveLength(1);
    expect(errorsFor(aliases)).toHaveLength(1);
  });
});

describe("NOT_IMPLEMENTED fallback", () => {
  it("fills unresolved root fields and keeps implemented resolvers", async () => {
    const executable = buildSchema(
      "type Query { ready: String, missing: String }",
    );
    executable.getQueryType()!.getFields().ready.resolve = () => "yes";

    fillNotImplemented(executable);
    const result = await graphql({
      schema: executable,
      source: "{ ready missing }",
    });

    expect(result.data).toEqual({ ready: "yes", missing: null });
    expect(result.errors?.[0]?.message).toBe("missing is not available yet");
    expect(result.errors?.[0]?.extensions.code).toBe("NOT_IMPLEMENTED");
  });

  it("fills subscriptions without subscribe functions", () => {
    const executable = buildSchema(
      "type Query { ok: Boolean } type Subscription { tick: Int }",
    );
    fillNotImplemented(executable);
    const tick = executable.getSubscriptionType()!.getFields().tick;

    expect(() => tick.subscribe!(undefined, {}, {}, {} as never)).toThrow(
      /tick is not available yet/,
    );
  });
});
