import { createServer } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GraphQLError, GraphQLSchema, parse } from "graphql";
import type { ServerOptions } from "graphql-ws";

const mocks = vi.hoisted(() => ({
  useServer: vi.fn<
    (options: ServerOptions) => { dispose: () => Promise<void> }
  >(() => ({ dispose: async () => {} })),
  subscribe: vi.fn(),
  execute: vi.fn(),
}));
vi.mock("graphql-ws/use/ws", () => ({ useServer: mocks.useServer }));
vi.mock("graphql", async (original) => ({
  ...(await original<typeof import("graphql")>()),
  subscribe: mocks.subscribe,
  execute: mocks.execute,
}));
import { attachSubscriptionServer } from "../../../src/kernel/ws/server.js";

const secret = "database credentials: private-password";
const args = { schema: new GraphQLSchema({}), document: parse("{ test }") };
const socketContext = { connectionParams: {}, extra: { request: {} } };

function options(
  context = async () => ({}),
  verifyConnection = async () => {},
) {
  attachSubscriptionServer(createServer(), args.schema, context, {
    verifyConnection,
  });
  return mocks.useServer.mock.calls.at(-1)![0] as ServerOptions;
}

async function expectMasked(call: () => unknown) {
  await expect(call()).rejects.toMatchObject({
    message: "GraphQL request failed",
    extensions: { code: "INTERNAL_SERVER_ERROR" },
  });
  try {
    await call();
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).not.toContain(secret);
    expect(error).not.toHaveProperty("cause");
  }
}

afterEach(() => vi.clearAllMocks());

describe("modern subscription exceptional hooks", () => {
  it("masks a rejected connection verifier", async () => {
    const hooks = options(undefined, async () => {
      throw new Error(secret);
    });
    await expectMasked(() => hooks.onConnect!(socketContext as never));
  });

  it("masks a rejected context factory", async () => {
    const hooks = options(async () => {
      throw new Error(secret);
    });
    await expectMasked(() =>
      (hooks.context as (context: typeof socketContext) => Promise<unknown>)(
        socketContext,
      ),
    );
  });

  it.each(["subscribe", "execute"] as const)(
    "masks synchronous and asynchronous %s failures",
    async (hook) => {
      const hooks = options();
      mocks[hook].mockImplementation(() => {
        throw new Error(secret);
      });
      await expectMasked(() => hooks[hook]!(args));
      mocks[hook].mockRejectedValue(new Error(secret));
      await expectMasked(() => hooks[hook]!(args));
    },
  );

  it("preserves a recognized public rejection", async () => {
    const hooks = options(undefined, async () => {
      throw new GraphQLError("Access token expired", {
        extensions: { code: "TOKEN_EXPIRED", secret },
      });
    });
    await expect(
      hooks.onConnect!(socketContext as never),
    ).rejects.toMatchObject({
      message: "Access token expired",
      extensions: { code: "TOKEN_EXPIRED" },
    });
  });

  it.each(["subscribe", "execute"] as const)(
    "keeps masked %s result errors serializable by graphql-ws",
    async (hook) => {
      mocks[hook].mockResolvedValue({
        errors: [new GraphQLError(secret)],
      });
      const result = await options()[hook]!(args);
      expect(Symbol.asyncIterator in result).toBe(false);
      const error = (result as { errors: GraphQLError[] }).errors[0]!;
      expect(error).toBeInstanceOf(GraphQLError);
      expect(error.toJSON()).toEqual({
        message: "GraphQL request failed",
        extensions: { code: "INTERNAL_SERVER_ERROR" },
      });
      expect(error.originalError).toBeUndefined();
    },
  );

  it("keeps streamed result errors serializable by graphql-ws", async () => {
    mocks.subscribe.mockResolvedValue(
      (async function* () {
        yield { errors: [new GraphQLError(secret)] };
      })(),
    );
    const stream = (await options().subscribe!(args)) as AsyncIterableIterator<{
      errors: GraphQLError[];
    }>;
    const event = await stream.next();
    expect(event.value.errors[0]!.toJSON()).toEqual({
      message: "GraphQL request failed",
      extensions: { code: "INTERNAL_SERVER_ERROR" },
    });
  });

  it("masks a stream rejection after a successful event", async () => {
    mocks.subscribe.mockResolvedValue(
      (async function* () {
        yield { data: { test: true } };
        throw new Error(secret);
      })(),
    );
    const stream = (await options().subscribe!(
      args,
    )) as AsyncIterableIterator<unknown>;
    await expect(stream.next()).resolves.toMatchObject({
      value: { data: { test: true } },
    });
    await expectMasked(() => stream.next());
  });
});
