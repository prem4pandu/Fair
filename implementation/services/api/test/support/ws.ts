import WebSocket from "ws";

type LegacyEvent = { type: string; id?: string; payload?: unknown };

export async function legacySubscribe(
  url: string,
  query: string,
  variables: Record<string, unknown>,
  connectionParams: Record<string, unknown> = { authorization: "" },
) {
  const socket = new WebSocket(url, "graphql-ws");
  const events: LegacyEvent[] = [];
  const waiters = new Set<() => void>();
  const wake = () => {
    for (const waiter of waiters) waiter();
    waiters.clear();
  };
  socket.on("message", (data) => {
    events.push(JSON.parse(String(data)) as LegacyEvent);
    wake();
  });

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Legacy WebSocket acknowledgement timed out")),
      3_000,
    );
    const fail = (error: Error) => {
      clearTimeout(timeout);
      reject(error);
    };
    socket.once("error", fail);
    socket.once("open", () => {
      socket.send(
        JSON.stringify({ type: "connection_init", payload: connectionParams }),
      );
      const check = () => {
        if (!events.some((event) => event.type === "connection_ack")) {
          waiters.add(check);
          return;
        }
        clearTimeout(timeout);
        socket.off("error", fail);
        resolve();
      };
      check();
    });
  });

  socket.send(
    JSON.stringify({ type: "start", id: "1", payload: { query, variables } }),
  );
  let cursor = 0;

  return {
    async next(timeoutMs = 3_000) {
      return new Promise<{
        data?: Record<string, unknown>;
        errors?: unknown[];
      }>((resolve, reject) => {
        const timer = setTimeout(() => {
          waiters.delete(check);
          reject(new Error("No subscription event"));
        }, timeoutMs);
        const check = () => {
          while (cursor < events.length) {
            const event = events[cursor++];
            if (event.id !== "1") continue;
            if (event.type === "data") {
              clearTimeout(timer);
              waiters.delete(check);
              resolve(event.payload as never);
              return;
            }
            if (event.type === "error" || event.type === "complete") {
              clearTimeout(timer);
              waiters.delete(check);
              reject(
                Object.assign(new Error(event.type), {
                  payload: event.payload,
                }),
              );
              return;
            }
          }
          waiters.add(check);
        };
        check();
      });
    },
    close() {
      if (socket.readyState === WebSocket.OPEN)
        socket.send(JSON.stringify({ type: "stop", id: "1" }));
      socket.close();
    },
  };
}
