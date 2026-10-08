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
  /** Runs once per connection; a rejection closes the connection. */
  onInit?: (params: Record<string, unknown>) => Promise<void>;
  /**
   * Runs for every `start`, so each subscription resolves its own context and
   * re-validates the user token instead of reusing one connection identity.
   */
  onConnect: (params: Record<string, unknown>) => Promise<unknown>;
  keepAliveMs: number;
  rules?: ValidationRule[];
  onDispose?: () => void;
};

type ActiveOperation = {
  generation: symbol;
  iterator: AsyncIterator<ExecutionResult>;
};

/**
 * Masks an arbitrary failure with the same allow-list as the HTTP transport:
 * known codes keep their documented message, everything else becomes the
 * generic INTERNAL_SERVER_ERROR text. Raw internals must never reach a client.
 */
export function sanitizeSubscriptionError(error: unknown): {
  message: string;
  extensions: { code: string };
} {
  const candidate = error as {
    message?: unknown;
    extensions?: Record<string, unknown>;
  };
  return formatError({
    message:
      typeof candidate?.message === "string"
        ? candidate.message
        : "Subscription failed",
    extensions: candidate?.extensions,
  });
}

// Server implementation of subscriptions-transport-ws, whose `graphql-ws`
// subprotocol is used by the pinned Enatega clients.
export class LegacySubscriptionSession {
  private connectionParams: Record<string, unknown> = {};
  private initialised = false;
  private disposed = false;
  private readonly operations = new Map<string, ActiveOperation>();
  private readonly pending = new Map<string, symbol>();
  private readonly startTasks = new Set<Promise<void>>();
  private keepAlive: NodeJS.Timeout | undefined;
  private messageQueue: Promise<void> = Promise.resolve();
  private disposal: Promise<void> | undefined;

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
      payload: formatError({
        message: "Subscription failed",
        extensions: { code: "INTERNAL_SERVER_ERROR" },
      }),
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
        {
          const task = this.start(message.id, message.payload).catch(() =>
            this.closeWithInternalError(),
          );
          this.startTasks.add(task);
          void task.finally(() => this.startTasks.delete(task));
        }
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
    this.connectionParams = params;
    try {
      await this.options.onInit?.(params);
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
        payload: sanitizeSubscriptionError(error),
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
    if (this.disposed) return;
    const generation = Symbol(id);
    this.pending.set(id, generation);

    let document;
    try {
      if (!payload || typeof payload.query !== "string") {
        throw new Error("Invalid operation");
      }
      document = parse(payload.query);
    } catch (error) {
      this.send({
        type: "error",
        id,
        payload: {
          message: error instanceof Error ? error.message : "Invalid operation",
        },
      });
      if (this.pending.get(id) === generation) this.pending.delete(id);
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
      if (this.pending.get(id) === generation) this.pending.delete(id);
      return;
    }

    // A fresh context per subscription means the user token, its signature and
    // the session's liveness are re-checked for every operation on the socket.
    let context: unknown;
    try {
      context = await this.options.onConnect(this.connectionParams);
    } catch (error) {
      if (this.pending.get(id) === generation) {
        this.pending.delete(id);
        this.send({
          type: "error",
          id,
          payload: sanitizeSubscriptionError(error),
        });
      }
      return;
    }
    if (this.disposed || this.pending.get(id) !== generation) return;

    let result;
    try {
      result = await subscribe({
        schema: this.schema,
        document,
        variableValues: payload.variables,
        operationName: payload.operationName,
        contextValue: context,
      });
    } catch (error) {
      if (this.pending.get(id) === generation) {
        this.pending.delete(id);
        this.send({
          type: "error",
          id,
          payload: sanitizeSubscriptionError(error),
        });
      }
      return;
    }

    if (!(Symbol.asyncIterator in result)) {
      if (this.pending.get(id) === generation) {
        this.pending.delete(id);
        this.send({
          type: "data",
          id,
          payload: {
            data: result.data ?? null,
            errors: result.errors?.map(sanitizeSubscriptionError),
          },
        });
        this.send({ type: "complete", id });
      }
      return;
    }

    const iterator = result[Symbol.asyncIterator]();
    if (this.disposed || this.pending.get(id) !== generation) {
      await iterator.return?.();
      return;
    }
    this.pending.delete(id);
    const operation = { generation, iterator };
    this.operations.set(id, operation);
    try {
      for (;;) {
        const next = await iterator.next();
        if (next.done || this.operations.get(id) !== operation) break;
        const value = next.value;
        this.send({
          type: "data",
          id,
          payload: value.errors
            ? {
                data: value.data ?? null,
                errors: value.errors.map(sanitizeSubscriptionError),
              }
            : { data: value.data },
        });
      }
      if (this.operations.get(id) === operation) {
        this.operations.delete(id);
        this.send({ type: "complete", id });
      }
    } catch (error) {
      if (this.operations.get(id) === operation) {
        this.operations.delete(id);
        this.send({
          type: "error",
          id,
          payload: sanitizeSubscriptionError(error),
        });
      }
    }
  }

  private async stop(id: string): Promise<void> {
    this.pending.delete(id);
    const operation = this.operations.get(id);
    this.operations.delete(id);
    await operation?.iterator.return?.();
  }

  dispose(): void {
    void this.disposeAsync();
  }

  disposeAsync(): Promise<void> {
    if (this.disposal) return this.disposal;
    this.disposed = true;
    if (this.keepAlive) clearInterval(this.keepAlive);
    this.pending.clear();
    const operations = [...this.operations.values()];
    this.operations.clear();
    this.disposal = Promise.allSettled(
      operations.map((operation) => operation.iterator.return?.()),
    )
      .then(() => Promise.allSettled([...this.startTasks]))
      .then(() => undefined)
      .finally(() => this.options.onDispose?.());
    return this.disposal;
  }
}
