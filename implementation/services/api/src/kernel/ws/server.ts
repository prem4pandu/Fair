import type { IncomingMessage, Server as HttpServer } from "node:http";
import type { Duplex } from "node:stream";
import { specifiedRules, validate, type GraphQLSchema } from "graphql";
import { useServer } from "graphql-ws/use/ws";
import { WebSocketServer } from "ws";
import { boundedOperation } from "../limits.js";
import { LegacySubscriptionSession } from "./legacy-protocol.js";

export type WsContextFactory = (
  params: Record<string, unknown>,
  request: IncomingMessage,
) => Promise<unknown>;

// Both generations share /graphql. Protocol negotiation routes each upgraded
// socket to the implementation matching Sec-WebSocket-Protocol.
export function attachSubscriptionServer(
  http: HttpServer,
  schema: GraphQLSchema,
  context: WsContextFactory,
): () => Promise<void> {
  const legacy = new WebSocketServer({
    noServer: true,
    handleProtocols: () => "graphql-ws",
  });
  const modern = new WebSocketServer({
    noServer: true,
    handleProtocols: () => "graphql-transport-ws",
  });

  legacy.on("connection", (socket, request: IncomingMessage) => {
    new LegacySubscriptionSession(socket, schema, {
      onConnect: (params) => context(params, request),
      keepAliveMs: 15_000,
      rules: [boundedOperation],
    });
  });

  const modernCleanup = useServer(
    {
      schema,
      validate: (activeSchema, document, rules, options, typeInfo) =>
        validate(
          activeSchema,
          document,
          [...(rules ?? specifiedRules), boundedOperation],
          options,
          typeInfo,
        ),
      context: (socketContext) =>
        context(
          (socketContext.connectionParams ?? {}) as Record<string, unknown>,
          socketContext.extra.request as unknown as IncomingMessage,
        ),
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
    for (const client of legacy.clients) client.terminate();
    for (const client of modern.clients) client.terminate();
    await Promise.all([
      new Promise<void>((resolve) => legacy.close(() => resolve())),
      new Promise<void>((resolve) => modern.close(() => resolve())),
    ]);
  };
}
