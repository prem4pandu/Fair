import {
  parse,
  specifiedRules,
  subscribe,
  validate,
  type ExecutionResult,
  type GraphQLSchema,
  type ValidationRule,
} from "graphql";
import type { WebSocket } from "ws";
import { formatError } from "../errors.js";

type LegacyMessage =
  | { type: "connection_init"; payload?: Record<string, unknown> }
  | {
      type: "start";
      id: string;
      payload: {
        query: string;
        variables?: Record<string, unknown>;
        operationName?: string;
      };
    }
  | { type: "stop"; id: string }
  | { type: "connection_terminate" };

export type LegacyOptions = {
  onConnect: (params: Record<string, unknown>) => Promise<unknown>;
  keepAliveMs: number;
  rules?: ValidationRule[];
};

// Server implementation of subscriptions-transport-ws, whose `graphql-ws`
// subprotocol is used by the pinned Enatega clients.
export class LegacySubscriptionSession {
  private context: unknown;
  private initialised = false;
  private disposed = false;
  private readonly operations = new Map<
    string,
    AsyncIterator<ExecutionResult>
  >();
  private keepAlive: NodeJS.Timeout | undefined;
  private messageQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly socket: Pick<
      WebSocket,
      "send" | "close" | "on" | "readyState"
    >,
    private readonly schema: GraphQLSchema,
    private readonly options: LegacyOptions,
  ) {
    socket.on("message", (data) => {
      this.messageQueue = this.messageQueue
        .then(() => this.handle(String(data)))
        .catch(() => this.closeWithInternalError());
    });
    socket.on("close", () => this.dispose());
  }

  private send(message: object): void {
    if (!this.disposed && this.socket.readyState === 1) {
      this.socket.send(JSON.stringify(message));
    }
  }

  private closeWithInternalError(): void {
    this.send({
      type: "connection_error",
      payload: { message: "Subscription failed" },
    });
    this.socket.close(1011);
    this.dispose();
  }

  private async handle(raw: string): Promise<void> {
    let message: LegacyMessage;
    try {
      message = JSON.parse(raw) as LegacyMessage;
    } catch {
      this.send({ type: "error", payload: { message: "Invalid message" } });
      return;
    }

    switch (message.type) {
      case "connection_init":
        await this.initialise(message.payload ?? {});
        return;
      case "start":
        void this.start(message.id, message.payload);
        return;
      case "stop":
        await this.stop(message.id);
        return;
      case "connection_terminate":
        this.dispose();
        this.socket.close(1000);
        return;
      default:
        this.send({
          type: "error",
          payload: { message: "Unknown message type" },
        });
    }
  }

  private async initialise(params: Record<string, unknown>): Promise<void> {
    if (this.initialised) {
      this.send({
        type: "connection_error",
        payload: { message: "Connection already initialised" },
      });
      return;
    }
    try {
      this.context = await this.options.onConnect(params);
      this.initialised = true;
      this.send({ type: "connection_ack" });
      if (this.options.keepAliveMs > 0) {
        this.send({ type: "ka" });
        this.keepAlive = setInterval(
          () => this.send({ type: "ka" }),
          this.options.keepAliveMs,
        );
      }
    } catch (error) {
      this.send({
        type: "connection_error",
        payload: {
          message:
            error instanceof Error ? error.message : "Connection rejected",
        },
      });
      this.socket.close(1011);
      this.dispose();
    }
  }

  private async start(
    id: string,
    payload: {
      query: string;
      variables?: Record<string, unknown>;
      operationName?: string;
    },
  ): Promise<void> {
    if (!this.initialised) {
      this.send({
        type: "error",
        id,
        payload: { message: "Connection not initialised" },
      });
      return;
    }
    await this.stop(id);

    let document;
    try {
      document = parse(payload.query);
    } catch (error) {
      this.send({
        type: "error",
        id,
        payload: {
          message: error instanceof Error ? error.message : "Invalid operation",
        },
      });
      return;
    }

    const errors = validate(this.schema, document, [
      ...specifiedRules,
      ...(this.options.rules ?? []),
    ]);
    if (errors.length > 0) {
      this.send({
        type: "error",
        id,
        payload: errors.map((error) =>
          formatError({
            message: error.message,
            extensions: { code: "GRAPHQL_VALIDATION_FAILED" },
          }),
        ),
      });
      return;
    }

    let result;
    try {
      result = await subscribe({
        schema: this.schema,
        document,
        variableValues: payload.variables,
        operationName: payload.operationName,
        contextValue: this.context,
      });
    } catch {
      this.send({
        type: "error",
        id,
        payload: { message: "Subscription failed" },
      });
      return;
    }

    if (!(Symbol.asyncIterator in result)) {
      this.send({
        type: "data",
        id,
        payload: {
          data: result.data ?? null,
          errors: result.errors?.map(formatError),
        },
      });
      this.send({ type: "complete", id });
      return;
    }

    const iterator = result[Symbol.asyncIterator]();
    this.operations.set(id, iterator);
    try {
      for (;;) {
        const next = await iterator.next();
        if (next.done || !this.operations.has(id)) break;
        const value = next.value;
        this.send({
          type: "data",
          id,
          payload: value.errors
            ? {
                data: value.data ?? null,
                errors: value.errors.map(formatError),
              }
            : { data: value.data },
        });
      }
      if (this.operations.delete(id)) this.send({ type: "complete", id });
    } catch {
      this.operations.delete(id);
      this.send({
        type: "error",
        id,
        payload: { message: "Subscription failed" },
      });
    }
  }

  private async stop(id: string): Promise<void> {
    const iterator = this.operations.get(id);
    this.operations.delete(id);
    await iterator?.return?.();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.keepAlive) clearInterval(this.keepAlive);
    for (const iterator of this.operations.values()) void iterator.return?.();
    this.operations.clear();
  }
}
