import { appError } from "./errors.js";

type MoneyOptions = {
  allowNegative?: boolean;
  rounding?: "half-up" | "reject";
};

/** Converts a decimal wire value into exact bigint minor units. */
export function toMinor(
  major: string | number,
  exponent: number,
  options: MoneyOptions = {},
): bigint {
  const { allowNegative = false, rounding = "half-up" } = options;
  if (!Number.isInteger(exponent) || exponent < 0 || exponent > 18) {
    throw appError("BAD_USER_INPUT", "Invalid currency exponent");
  }
  if (
    typeof major === "number" &&
    (!Number.isFinite(major) || !Number.isSafeInteger(major * 10 ** exponent))
  ) {
    throw appError(
      "BAD_USER_INPUT",
      "Unsafe numeric amount; send a decimal string",
    );
  }

  const match = String(major)
    .trim()
    .match(/^(-?)(\d+)(?:\.(\d+))?$/);
  if (!match) throw appError("BAD_USER_INPUT", "Invalid amount");

  const negative = match[1] === "-";
  if (negative && !allowNegative) {
    throw appError("BAD_USER_INPUT", "Amount must not be negative");
  }

  const fraction = match[3] ?? "";
  const discarded = fraction.slice(exponent);
  if (rounding === "reject" && /[1-9]/.test(discarded)) {
    throw appError("BAD_USER_INPUT", "Amount has too many decimal places");
  }

  const digits = `${match[2]}${fraction.slice(0, exponent).padEnd(exponent, "0")}`;
  let minor = BigInt(digits);
  if (rounding === "half-up" && (discarded[0] ?? "0") >= "5") minor += 1n;
  if (negative) minor = -minor;
  return minor === 0n ? 0n : minor;
}

export function toMajor(minor: bigint, exponent: number): string {
  if (!Number.isInteger(exponent) || exponent < 0 || exponent > 18) {
    throw appError("BAD_USER_INPUT", "Invalid currency exponent");
  }
  const negative = minor < 0n;
  const digits = (negative ? -minor : minor)
    .toString()
    .padStart(exponent + 1, "0");
  const value =
    exponent === 0
      ? digits
      : `${digits.slice(0, -exponent)}.${digits.slice(-exponent)}`;
  return negative ? `-${value}` : value;
}

export function sumMinor(values: readonly bigint[]): bigint {
  return values.reduce((total, value) => total + value, 0n);
}

/** Applies integer basis points (750n = 7.5%) with half-up rounding. */
export function percentOf(minor: bigint, basisPoints: bigint): bigint {
  const numerator = minor * basisPoints;
  return (numerator + (numerator >= 0n ? 5_000n : -5_000n)) / 10_000n;
}
