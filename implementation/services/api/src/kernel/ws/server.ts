import type { IncomingMessage, Server as HttpServer } from "node:http";
import type { Duplex } from "node:stream";
import {
  execute as graphqlExecute,
  GraphQLError,
  specifiedRules,
  subscribe as graphqlSubscribe,
  validate,
  type ExecutionResult,
  type GraphQLSchema,
} from "graphql";
import { useServer } from "graphql-ws/use/ws";
import { WebSocketServer } from "ws";
import { boundedOperation } from "../limits.js";
import {
  LegacySubscriptionSession,
  sanitizeSubscriptionError,
} from "./legacy-protocol.js";

export const WS_MAX_PAYLOAD_BYTES = 1024 * 1024;

export const subscriptionServerOptions = (
  protocol: "graphql-ws" | "graphql-transport-ws",
) => ({
  noServer: true as const,
  maxPayload: WS_MAX_PAYLOAD_BYTES,
  handleProtocols: () => protocol,
});

export type WsContextFactory = (
  params: Record<string, unknown>,
  request: IncomingMessage,
) => Promise<unknown>;

export type SubscriptionServerHooks = {
  /**
   * Runs before a socket is acknowledged. A rejection closes the connection:
   * this is where a supplied public-access token is verified.
   */
  verifyConnection?: (params: Record<string, unknown>) => Promise<void>;
};

const sanitizeResult = <T extends ExecutionResult>(result: T): T =>
  result.errors?.length
    ? ({
        ...result,
        errors: result.errors.map((error) => {
          const safe = sanitizeSubscriptionError(error);
          // graphql-ws serializes execution errors by calling toJSON().
          return new GraphQLError(safe.message, {
            extensions: safe.extensions,
          });
        }),
      } as T)
    : result;

// graphql-ws uses Error.message as the close reason outside production.
// Re-throw only the public error, without retaining the original cause.
async function sanitizedCall<T>(call: () => T | Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    const safe = sanitizeSubscriptionError(error);
    throw Object.assign(new Error(safe.message), {
      extensions: safe.extensions,
    });
  }
}

async function* sanitizeStream(
  stream: AsyncIterable<ExecutionResult>,
): AsyncGenerator<ExecutionResult> {
  try {
    for await (const result of stream) yield sanitizeResult(result);
  } catch (error) {
    const safe = sanitizeSubscriptionError(error);
    throw Object.assign(new Error(safe.message), {
      extensions: safe.extensions,
    });
  }
}

// Both generations share /graphql. Protocol negotiation routes each upgraded
// socket to the implementation matching Sec-WebSocket-Protocol.
export function attachSubscriptionServer(
  http: HttpServer,
  schema: GraphQLSchema,
  context: WsContextFactory,
  hooks: SubscriptionServerHooks = {},
): () => Promise<void> {
  const legacy = new WebSocketServer(subscriptionServerOptions("graphql-ws"));
  const modern = new WebSocketServer(
    subscriptionServerOptions("graphql-transport-ws"),
  );

  const legacySessions = new Set<LegacySubscriptionSession>();
  legacy.on("connection", (socket, request: IncomingMessage) => {
    const session = new LegacySubscriptionSession(socket, schema, {
      onInit: hooks.verifyConnection,
      onConnect: (params) => context(params, request),
      keepAliveMs: 15_000,
      rules: [boundedOperation],
      onDispose: () => legacySessions.delete(session),
    });
    legacySessions.add(session);
  });

  const modernCleanup = useServer(
    {
      schema,
      onConnect: async (socketContext) => {
        await sanitizedCall(() =>
          hooks.verifyConnection?.(
            (socketContext.connectionParams ?? {}) as Record<string, unknown>,
          ),
        );
        return true;
      },
      validate: (activeSchema, document, rules, options, typeInfo) =>
        validate(
          activeSchema,
          document,
          [...(rules ?? specifiedRules), boundedOperation],
          options,
          typeInfo,
        ),
      // graphql-ws invokes `context` once per operation, so each subscription
      // gets its own context and re-resolves the caller's identity.
      context: (socketContext) =>
        sanitizedCall(() =>
          context(
            (socketContext.connectionParams ?? {}) as Record<string, unknown>,
            socketContext.extra.request as unknown as IncomingMessage,
          ),
        ),
      subscribe: async (args) => {
        const result = await sanitizedCall(() => graphqlSubscribe(args));
        if (result && Symbol.asyncIterator in result)
          return sanitizeStream(result as AsyncIterable<ExecutionResult>);
        return sanitizeResult(result as ExecutionResult);
      },
      execute: async (args) =>
        sanitizeResult(await sanitizedCall(() => graphqlExecute(args))),
    },
    modern,
  );

  const onUpgrade = (
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): void => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname !== "/graphql") {
      socket.destroy();
      return;
    }
    const offered = String(request.headers["sec-websocket-protocol"] ?? "")
      .split(",")
      .map((protocol) => protocol.trim());
    const target = offered.includes("graphql-transport-ws")
      ? modern
      : offered.includes("graphql-ws")
        ? legacy
        : undefined;
    if (!target) {
      socket.destroy();
      return;
    }
    target.handleUpgrade(request, socket, head, (webSocket) => {
      target.emit("connection", webSocket, request);
    });
  };
  http.on("upgrade", onUpgrade);

  return async () => {
    http.off("upgrade", onUpgrade);
    await modernCleanup.dispose();
    await Promise.allSettled(
      [...legacySessions].map((session) => session.disposeAsync()),
    );
    for (const client of legacy.clients) client.terminate();
    for (const client of modern.clients) client.terminate();
    await Promise.all([
      new Promise<void>((resolve) => legacy.close(() => resolve())),
      new Promise<void>((resolve) => modern.close(() => resolve())),
    ]);
  };
}
