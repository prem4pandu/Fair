import WebSocket from "ws";

export type Frame = { type: string; id?: string; payload?: unknown };

type Waiter = () => void;

/**
 * Minimal frame-level WebSocket client. Both Enatega protocols are proven at
 * the frame level: the pinned clients speak the legacy
 * `subscriptions-transport-ws` set under the `graphql-ws` subprotocol, while
 * our own tooling uses `graphql-transport-ws`.
 */
export class FrameClient {
  readonly frames: Frame[] = [];
  readonly closed: Promise<{ code: number; reason: string }>;
  private readonly consumed = new Set<number>();
  private readonly waiters = new Set<Waiter>();
  private readonly socket: WebSocket;

  constructor(url: string, protocol: string) {
    this.socket = new WebSocket(url, protocol);
    this.socket.on("message", (data) => {
      this.frames.push(JSON.parse(String(data)) as Frame);
      this.wake();
    });
    this.socket.on("error", () => this.wake());
    this.closed = new Promise((resolve) => {
      this.socket.on("close", (code, reason) => {
        resolve({ code, reason: String(reason) });
        this.wake();
      });
    });
  }

  private wake(): void {
    for (const waiter of this.waiters) waiter();
    this.waiters.clear();
  }

  async open(timeoutMs = 3_000): Promise<void> {
    if (this.socket.readyState === WebSocket.OPEN) return;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("WebSocket open timed out")),
        timeoutMs,
      );
      this.socket.once("open", () => {
        clearTimeout(timer);
        resolve();
      });
      this.socket.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
  }

  send(frame: object): void {
    if (this.socket.readyState !== WebSocket.OPEN)
      throw new Error("WebSocket is not open");
    this.socket.send(JSON.stringify(frame));
  }

  /** Returns the next unconsumed frame matching `predicate`. */
  async take<T extends Frame = Frame>(
    predicate: (frame: Frame) => boolean,
    timeoutMs = 3_000,
  ): Promise<T> {
    let closed = false;
    void this.closed.then(() => {
      closed = true;
      this.wake();
    });
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      for (let index = 0; index < this.frames.length; index += 1) {
        const frame = this.frames[index]!;
        if (!this.consumed.has(index) && predicate(frame)) {
          this.consumed.add(index);
          return frame as T;
        }
      }
      const remaining = deadline - Date.now();
      if (closed || remaining <= 0)
        throw new Error(
          `No WebSocket frame matched within ${timeoutMs}ms: ${JSON.stringify(this.frames)}`,
        );
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          this.waiters.delete(wake);
          resolve();
        }, remaining);
        const wake = () => {
          clearTimeout(timer);
          resolve();
        };
        this.waiters.add(wake);
      });
    }
  }

  close(): void {
    this.socket.close();
  }
}

export type ConnectionParams = Record<string, unknown>;

/** Opens a socket and completes the protocol handshake. */
export async function openFrameClient(
  url: string,
  protocol: "graphql-ws" | "graphql-transport-ws",
  connectionParams: ConnectionParams = { authorization: "" },
  timeoutMs = 3_000,
): Promise<FrameClient> {
  const client = new FrameClient(url, protocol);
  await client.open(timeoutMs);
  client.send({ type: "connection_init", payload: connectionParams });
  await client.take((frame) => frame.type === "connection_ack", timeoutMs);
  return client;
}

/** Legacy `subscriptions-transport-ws` frames, as every pinned app sends them. */
export async function legacySubscribe(
  url: string,
  query: string,
  variables: Record<string, unknown>,
  connectionParams: ConnectionParams = { authorization: "" },
) {
  const client = await openFrameClient(url, "graphql-ws", connectionParams);
  client.send({ type: "start", id: "1", payload: { query, variables } });
  return {
    client,
    async next(timeoutMs = 3_000) {
      const frame = await client.take<Frame>(
        (candidate) => candidate.id === "1" && candidate.type === "data",
        timeoutMs,
      );
      return frame.payload;
    },
    close() {
      if (client.frames.some((frame) => frame.type === "connection_ack"))
        client.send({ type: "stop", id: "1" });
      client.close();
    },
  };
}
