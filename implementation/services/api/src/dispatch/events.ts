import type { OfferFlag } from "./types.js";

export type DispatchDomainEvent =
  | Readonly<{
      type: "dispatch.offer_opened";
      orderId: string;
      zoneId: string;
    }>
  | Readonly<{
      type: "dispatch.offer_flagged";
      orderId: string;
      reason: OfferFlag;
    }>
  | Readonly<{
      type: "dispatch.offer_claimed";
      orderId: string;
      riderId: string;
      zoneId: string;
    }>
  | Readonly<{
      type: "dispatch.offer_rejected";
      orderId: string;
      riderId: string;
      rejectedAt: string;
      reason: string | null;
    }>;
