import { appError } from "./errors.js";

export type Point = { type: "Point"; coordinates: [number, number] };
export type Polygon = { type: "Polygon"; coordinates: [number, number][][] };

export const point = (longitude: number, latitude: number): Point => ({
  type: "Point",
  coordinates: [longitude, latitude],
});

export function parseCoordinate(
  value: unknown,
  axis: "latitude" | "longitude",
): number {
  const numeric = typeof value === "string" ? Number(value.trim()) : value;
  const limit = axis === "latitude" ? 90 : 180;
  if (
    typeof numeric !== "number" ||
    !Number.isFinite(numeric) ||
    Math.abs(numeric) > limit
  ) {
    throw appError("BAD_USER_INPUT", `Invalid ${axis}`);
  }
  return numeric;
}

export function polygon(rings: unknown): Polygon {
  if (!Array.isArray(rings) || rings.length === 0) {
    throw appError("BAD_USER_INPUT", "Invalid polygon");
  }
  const parsed = rings.map((ring) => {
    if (!Array.isArray(ring) || ring.length < 4) {
      throw appError("BAD_USER_INPUT", "Polygon ring must be closed");
    }
    const points = ring.map((pair) => {
      if (!Array.isArray(pair) || pair.length !== 2) {
        throw appError("BAD_USER_INPUT", "Invalid polygon");
      }
      return [
        parseCoordinate(pair[0], "longitude"),
        parseCoordinate(pair[1], "latitude"),
      ] as [number, number];
    });
    const first = points[0];
    const last = points[points.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) {
      throw appError("BAD_USER_INPUT", "Polygon ring must be closed");
    }
    return points;
  });
  return { type: "Polygon", coordinates: parsed };
}

export function containsPoint(
  shape: Polygon,
  longitude: number,
  latitude: number,
): boolean {
  const inRing = (ring: [number, number][]) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (
        yi > latitude !== yj > latitude &&
        longitude < ((xj - xi) * (latitude - yi)) / (yj - yi) + xi
      ) {
        inside = !inside;
      }
    }
    return inside;
  };
  const [outer, ...holes] = shape.coordinates;
  return inRing(outer) && !holes.some(inRing);
}

export function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const radians = Math.PI / 180;
  const a =
    Math.sin(((lat2 - lat1) * radians) / 2) ** 2 +
    Math.cos(lat1 * radians) *
      Math.cos(lat2 * radians) *
      Math.sin(((lng2 - lng1) * radians) / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.sqrt(a));
}

const days = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"] as const;
type Day = (typeof days)[number];
type Slot = { startTime: [string, string]; endTime: [string, string] };
export type OpeningTimes = { day: Day; times: Slot[] }[];

function hhmm(value: unknown): [string, string] {
  const parts = Array.isArray(value)
    ? value.map(String)
    : String(value ?? "").split(":");
  if (
    parts.length !== 2 ||
    !/^\d{1,2}$/.test(parts[0]) ||
    !/^\d{1,2}$/.test(parts[1])
  ) {
    throw appError("BAD_USER_INPUT", "Invalid opening time");
  }
  const [hour, minute] = parts.map(Number);
  if (hour > 23 || minute > 59) {
    throw appError("BAD_USER_INPUT", "Invalid opening time");
  }
  return [String(hour).padStart(2, "0"), String(minute).padStart(2, "0")];
}

export function openingTimes(input: unknown): OpeningTimes {
  if (!Array.isArray(input))
    throw appError("BAD_USER_INPUT", "Invalid opening times");
  return input.map((rawEntry: unknown) => {
    if (typeof rawEntry !== "object" || rawEntry === null) {
      throw appError("BAD_USER_INPUT", "Invalid opening times");
    }
    const entry = rawEntry as { day?: unknown; times?: unknown };
    const day = String(entry.day ?? "") as Day;
    if (!days.includes(day))
      throw appError("BAD_USER_INPUT", "Invalid opening day");
    const slots = Array.isArray(entry.times) ? entry.times : [];
    const times = slots.map((rawSlot: unknown) => {
      if (typeof rawSlot !== "object" || rawSlot === null) {
        throw appError("BAD_USER_INPUT", "Invalid opening time");
      }
      const slot = rawSlot as { startTime?: unknown; endTime?: unknown };
      const startTime = hhmm(slot.startTime);
      const endTime = hhmm(slot.endTime);
      if (startTime.join("") > endTime.join("")) {
        throw appError(
          "BAD_USER_INPUT",
          "Opening time must end after it starts",
        );
      }
      return { startTime, endTime };
    });
    return { day, times };
  });
}

export function isOpenAt(
  times: OpeningTimes,
  at: Date,
  timeZone: string,
): boolean {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const weekday = parts
    .find((part) => part.type === "weekday")
    ?.value.toUpperCase()
    .slice(0, 3);
  const hour = parts.find((part) => part.type === "hour")?.value;
  const minute = parts.find((part) => part.type === "minute")?.value;
  if (!weekday || hour === undefined || minute === undefined) return false;
  const clock = `${hour}${minute}`;
  return times
    .filter((entry) => entry.day === weekday)
    .some((entry) =>
      entry.times.some(
        (slot) =>
          slot.startTime.join("") <= clock && clock <= slot.endTime.join(""),
      ),
    );
}
