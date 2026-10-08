import { appError } from "../kernel/errors.js";

export type LocationPolicy = Readonly<{
  maxFutureSkewSeconds: number;
  maxAgeSeconds: number;
  minIntervalMs: number;
}>;

export type PreviousLocation = Readonly<{
  recordedAt: Date;
  receivedAt: Date;
}>;

export type LocationInput = Readonly<{
  latitude: string | number;
  longitude: string | number;
  accuracy?: string | number | null;
  heading?: string | number | null;
  speed?: string | number | null;
  deviceTimestamp?: string | null;
}>;

export type ValidatedLocation = Readonly<{
  latitude: number;
  longitude: number;
  accuracy: number | null;
  heading: number | null;
  speed: number | null;
  recordedAt: Date;
  receivedAt: Date;
}>;

function numeric(
  value: string | number | null | undefined,
  label: string,
): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed))
    throw appError("BAD_USER_INPUT", `Invalid ${label}`);
  return parsed;
}

export function validateLocationUpdate(
  input: LocationInput,
  receivedAt: Date,
  previous: PreviousLocation | null,
  policy: LocationPolicy,
): ValidatedLocation {
  const latitude = numeric(input.latitude, "latitude");
  const longitude = numeric(input.longitude, "longitude");
  if (latitude < -90 || latitude > 90)
    throw appError("BAD_USER_INPUT", "Invalid latitude");
  if (longitude < -180 || longitude > 180)
    throw appError("BAD_USER_INPUT", "Invalid longitude");

  const accuracy =
    input.accuracy == null ? null : numeric(input.accuracy, "accuracy");
  if (accuracy !== null && (accuracy < 0 || accuracy > 10_000))
    throw appError("BAD_USER_INPUT", "Invalid accuracy");
  const rawHeading =
    input.heading == null ? null : numeric(input.heading, "heading");
  if (rawHeading !== null && (rawHeading < -1 || rawHeading > 360))
    throw appError("BAD_USER_INPUT", "Invalid heading");
  const rawSpeed = input.speed == null ? null : numeric(input.speed, "speed");
  if (rawSpeed !== null && (rawSpeed < -1 || rawSpeed > 100))
    throw appError("BAD_USER_INPUT", "Invalid speed");

  const recordedAt = input.deviceTimestamp
    ? new Date(input.deviceTimestamp)
    : receivedAt;
  if (Number.isNaN(recordedAt.getTime()))
    throw appError("BAD_USER_INPUT", "Invalid deviceTimestamp");
  if (
    recordedAt.getTime() - receivedAt.getTime() >
    policy.maxFutureSkewSeconds * 1000
  ) {
    throw appError("BAD_USER_INPUT", "Location timestamp is in the future");
  }
  if (
    receivedAt.getTime() - recordedAt.getTime() >
    policy.maxAgeSeconds * 1000
  ) {
    throw appError("BAD_USER_INPUT", "Location timestamp is too old");
  }
  if (
    previous &&
    receivedAt.getTime() - previous.receivedAt.getTime() < policy.minIntervalMs
  ) {
    throw appError("RATE_LIMITED", "Location updates are too frequent");
  }
  if (previous && recordedAt.getTime() <= previous.recordedAt.getTime()) {
    throw appError("BAD_USER_INPUT", "Location is older than the last update");
  }
  return {
    latitude,
    longitude,
    accuracy,
    heading: rawHeading !== null && rawHeading < 0 ? null : rawHeading,
    speed: rawSpeed !== null && rawSpeed < 0 ? null : rawSpeed,
    recordedAt,
    receivedAt,
  };
}
