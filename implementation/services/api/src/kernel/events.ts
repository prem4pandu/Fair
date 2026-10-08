import type { OrderSnapshot } from "./ports.js";

export type DomainEvent =
  | { type: "order.placed"; payload: OrderSnapshot }
  | {
      type: "order.transitioned";
      payload: {
        from: string;
        to: string;
        order: OrderSnapshot;
        actor: { type: string; id: string };
        reason?: string;
      };
    }
  | {
      type: "order.paid";
      payload: {
        orderId: string;
        providerReference: string;
        paidMinor: bigint;
      };
    }
  | {
      type: "rider.location";
      payload: {
        riderId: string;
        longitude: number;
        latitude: number;
        recordedAt: string;
      };
    }
  | { type: "withdraw.updated"; payload: { requestId: string; status: string } }
  | {
      type: "user.otp";
      payload: {
        channel: "email" | "sms";
        to: string;
        code: string;
        purpose: "signup" | "reset" | "login";
      };
    }
  | {
      type: "ticket.message";
      payload: { ticketId: string; senderType: "USER" | "ADMIN" };
    };

export type EventHandler<T extends DomainEvent["type"]> = (
  event: Extract<DomainEvent, { type: T }>,
) => Promise<void>;
