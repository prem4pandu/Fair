import { randomBytes } from "node:crypto";
import { appError } from "./errors.js";

let lastMs = 0;
let sequence = 0;

/** Creates a lexically time-ordered RFC 9562 UUIDv7. */
export function newId(now = Date.now()): string {
  let timestamp = Math.max(now, lastMs);
  if (timestamp === lastMs) {
    sequence = (sequence + 1) & 0xfff;
    if (sequence === 0) timestamp += 1;
  } else {
    sequence = randomBytes(2).readUInt16BE() & 0x7ff;
  }
  lastMs = timestamp;

  const bytes = randomBytes(16);
  bytes.writeUIntBE(timestamp, 0, 6);
  bytes[6] = 0x70 | (sequence >> 8);
  bytes[7] = sequence & 0xff;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function parseId(value: unknown, field: string): string {
  if (typeof value !== "string" || !uuid.test(value.toLowerCase())) {
    throw appError("BAD_USER_INPUT", `Invalid ${field} id`);
  }
  return value.toLowerCase();
}

export function parseOptionalId(value: unknown, field: string): string | null {
  return value == null || value === "" ? null : parseId(value, field);
}
