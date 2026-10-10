import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import {
  buildSchema,
  getNamedType,
  isEnumType,
  isInputObjectType,
  isInterfaceType,
  isListType,
  isNonNullType,
  isObjectType,
  isScalarType,
  isUnionType,
  type GraphQLArgument,
  type GraphQLField,
  type GraphQLInputType,
  type GraphQLOutputType,
  type GraphQLSchema,
} from "graphql";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadTypeDefs } from "../../../src/kernel/schema.js";
import { startApi, type Api } from "../../support/app.js";
import { startStack, type Stack } from "../../support/stack.js";
import { legacySubscribe } from "../../support/ws.js";

type InventoryOperation = { type: string; name: string; lane: string };

const inventory = JSON.parse(
  readFileSync(
    new URL("../../../../../docs/OPERATION_LANES.json", import.meta.url),
    "utf8",
  ),
) as { operations: InventoryOperation[] };

const introspection = `query RuntimeContract {
  __schema {
    queryType { fields { name } }
    mutationType { fields { name } }
    subscriptionType { fields { name } }
  }
}`;

const requiredArguments = (
  field: Pick<GraphQLField<unknown, unknown>, "args">,
): readonly GraphQLArgument[] =>
  field.args.filter(
    (argument) =>
      isNonNullType(argument.type) && argument.defaultValue === undefined,
  );

const optional = (
  field: Pick<GraphQLField<unknown, unknown>, "args">,
): boolean =>
  field.args.every(
    (argument) =>
      !isNonNullType(argument.type) || argument.defaultValue !== undefined,
  );

const valueFor = (type: GraphQLInputType): unknown => {
  if (isNonNullType(type)) return valueFor(type.ofType);
  if (isListType(type)) return [valueFor(type.ofType)];
  if (isScalarType(type)) {
    switch (type.name) {
      case "Int":
        return 1;
      case "Float":
        return 1.5;
      case "Boolean":
        return true;
      case "ID":
        return randomUUID();
      default:
        return "smoke";
    }
  }
  if (isEnumType(type)) return type.getValues()[0]!.value;
  if (isInputObjectType(type)) {
    const value: Record<string, unknown> = {};
    for (const field of Object.values(type.getFields()))
      if (isNonNullType(field.type) && field.defaultValue === undefined)
        value[field.name] = valueFor(field.type);
    return value;
  }
  throw new Error(`Unsupported input type ${String(type)}`);
};

/** A minimal, schema-valid selection set for any output type. */
const selectionFor = (type: GraphQLOutputType, depth = 0): string => {
  const named = getNamedType(type);
  if (isScalarType(named) || isEnumType(named)) return "";
  if (isUnionType(named)) return "{ __typename }";
  if (!isObjectType(named) && !isInterfaceType(named)) return "";
  const fields = Object.values(named.getFields());
  const leaves = fields.filter(
    (field) =>
      optional(field) &&
      (isScalarType(getNamedType(field.type)) ||
        isEnumType(getNamedType(field.type))),
  );
  if (leaves.length > 0)
    return `{ ${leaves
      .slice(0, 3)
      .map((field) => field.name)
      .join(" ")} }`;
  if (depth < 3)
    for (const field of fields.filter(optional)) {
      const inner = selectionFor(field.type, depth + 1);
      if (inner) return `{ ${field.name} ${inner} }`;
    }
  return "{ __typename }";
};

/** The same SDL composition the runtime loads, for argument metadata. */
const servedSchema = (): GraphQLSchema =>
  buildSchema(loadTypeDefs().join("\n"));

const rootFields = (
  schema: GraphQLSchema,
  kind: "query" | "mutation" | "subscription",
): Record<string, GraphQLField<unknown, unknown>> => {
  const type =
    kind === "query"
      ? schema.getQueryType()
      : kind === "mutation"
        ? schema.getMutationType()
        : schema.getSubscriptionType();
  return (type?.getFields() ?? {}) as Record<
    string,
    GraphQLField<unknown, unknown>
  >;
};

describe("runtime contract completeness", () => {
  let stack: Stack;
  let api: Api;

  beforeAll(async () => {
    stack = await startStack();
    api = await startApi(stack);
  });
  afterAll(async () => {
    await api?.close();
    await stack?.release();
  });

  it("serves every inventory root in the running schema", async () => {
    const response = await api.http.query<{
      __schema: {
        queryType: { fields: { name: string }[] };
        mutationType: { fields: { name: string }[] };
        subscriptionType: { fields: { name: string }[] };
      };
    }>(introspection);
    expect(response.errors).toEqual([]);
    const schema = response.data!.__schema;
    const served = new Set<string>([
      ...schema.queryType.fields.map((field) => `query.${field.name}`),
      ...schema.mutationType.fields.map((field) => `mutation.${field.name}`),
      ...schema.subscriptionType.fields.map(
        (field) => `subscription.${field.name}`,
      ),
    ]);
    const missing = inventory.operations
      .map((operation) => `${operation.type}.${operation.name}`)
      .filter((key) => !served.has(key));
    expect(missing).toEqual([]);
    expect(inventory.operations.length).toBe(334);
  });

  it("returns NOT_IMPLEMENTED for every L12 query and mutation", async () => {
    const schema = servedSchema();
    const failures: string[] = [];
    const l12 = inventory.operations.filter(
      (operation) =>
        operation.lane === "L12" && operation.type !== "subscription",
    );
    expect(l12.length).toBe(70);
    for (const operation of l12) {
      const field = rootFields(schema, operation.type as "query")[
        operation.name
      ]!;
      const required = requiredArguments(field);
      const variables = Object.fromEntries(
        required.map((argument) => [argument.name, valueFor(argument.type)]),
      );
      const variableDefinitions = required
        .map((argument) => `$${argument.name}: ${argument.type}`)
        .join(", ");
      const call = required.length
        ? `(${required.map((argument) => `${argument.name}: $${argument.name}`).join(", ")})`
        : "";
      const query = `${operation.type} Smoke${variableDefinitions ? `(${variableDefinitions})` : ""} { ${operation.name}${call} ${selectionFor(field.type)} }`;
      const result = await api.http.query(query, variables);
      const code = result.errors[0]?.extensions.code;
      if (code !== "NOT_IMPLEMENTED")
        failures.push(
          `${operation.type}.${operation.name}: ${code ?? "no error"} (${JSON.stringify(result).slice(0, 200)})`,
        );
    }
    expect(failures).toEqual([]);
  }, 120_000);

  it("returns NOT_IMPLEMENTED for the L12 subscription over the legacy frames", async () => {
    const field = rootFields(servedSchema(), "subscription")[
      "subscriptionPaymentSuccess"
    ]!;
    const required = requiredArguments(field);
    const variables = Object.fromEntries(
      required.map((argument) => [argument.name, valueFor(argument.type)]),
    );
    const variableDefinitions = required
      .map((argument) => `$${argument.name}: ${argument.type}`)
      .join(", ");
    const query = `subscription Smoke${variableDefinitions ? `(${variableDefinitions})` : ""} { subscriptionPaymentSuccess(${required
      .map((argument) => `${argument.name}: $${argument.name}`)
      .join(", ")}) ${selectionFor(field.type)} }`;
    const subscription = await legacySubscribe(api.wsUrl, query, variables, {
      nonce: "runtime-contract",
    });
    try {
      const payload = (await subscription.next()) as {
        errors?: { extensions?: { code?: string } }[];
      };
      expect(payload.errors?.[0]?.extensions?.code).toBe("NOT_IMPLEMENTED");
    } finally {
      subscription.close();
    }
  });

  it("still serves implemented multivendor roots", async () => {
    const configuration = await api.http.query<{
      configuration: { currency: string } | null;
    }>("{ configuration { currency } }");
    expect(configuration.errors ?? []).not.toContainEqual(
      expect.objectContaining({
        extensions: expect.objectContaining({ code: "NOT_IMPLEMENTED" }),
      }),
    );
  });
});
