import { describe, expect, it } from "vitest";
import { newId, parseId } from "../../../src/kernel/ids.js";
import {
  percentOf,
  sumMinor,
  toMajor,
  toMinor,
} from "../../../src/kernel/money.js";
import {
  epochMillisString,
  isoString,
  parseClientDate,
} from "../../../src/kernel/time.js";
import {
  containsPoint,
  haversineKm,
  isOpenAt,
  openingTimes,
  parseCoordinate,
  point,
  polygon,
} from "../../../src/kernel/geo.js";
import { p1, p2, p4, p6, paginate } from "../../../src/kernel/pagination.js";

describe("ids", () => {
  it("creates time-ordered UUIDv7 ids", () => {
    const a = newId();
    const b = newId();
    expect(a).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(a < b).toBe(true);
  });

  it("rejects malformed ids with BAD_USER_INPUT", () => {
    expect(() => parseId("abc", "restaurant")).toThrow(/restaurant/);
    expect(parseId(newId().toUpperCase(), "x")).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("money", () => {
  it("converts decimal wire values to bigint minor units with half-up rounding", () => {
    expect(toMinor("12.345", 2)).toBe(1235n);
    expect(toMinor("0.30", 2)).toBe(30n);
    expect(toMinor("1000", 0)).toBe(1000n);
    expect(toMinor("1.2345", 3)).toBe(1235n);
  });

  it("converts back to an exact decimal wire string", () => {
    expect(toMajor(1235n, 2)).toBe("12.35");
    expect(toMajor(5n, 0)).toBe("5");
  });

  it("rejects malformed, over-precision and negative amounts where required", () => {
    expect(() => toMinor("NaN", 2)).toThrow();
    expect(() => toMinor("1.234", 2, { rounding: "reject" })).toThrow();
    expect(() => toMinor("-1", 2, { allowNegative: false })).toThrow();
  });

  it("keeps arithmetic exact beyond Number.MAX_SAFE_INTEGER", () => {
    const boundary = BigInt(Number.MAX_SAFE_INTEGER) + 10_000n;
    expect(sumMinor([boundary, 250n, 1n])).toBe(boundary + 251n);
    expect(percentOf(boundary, 750n)).toBe(
      (boundary * 750n + 5_000n) / 10_000n,
    );
    expect(toMajor(boundary, 2)).toBe("90071992547509.91");
  });

  it("rejects unsafe number inputs at the wire boundary", () => {
    expect(() => toMinor(Number.MAX_SAFE_INTEGER + 1, 2)).toThrow();
  });
});

describe("time", () => {
  const date = new Date("2026-10-08T12:00:00.000Z");

  it("formats lifecycle timestamps as ISO and review timestamps as epoch ms strings", () => {
    expect(isoString(date)).toBe("2026-10-08T12:00:00.000Z");
    expect(epochMillisString(date)).toBe(String(date.getTime()));
    expect(isoString(null)).toBeNull();
  });

  it("parses YYYY-MM-DD and full ISO client dates", () => {
    expect(parseClientDate("2026-10-08")?.toISOString()).toBe(
      "2026-10-08T00:00:00.000Z",
    );
    expect(parseClientDate("2026-10-07T18:30:00.000Z")?.toISOString()).toBe(
      "2026-10-07T18:30:00.000Z",
    );
    expect(parseClientDate("nonsense")).toBeNull();
  });
});

describe("geo", () => {
  it("builds GeoJSON points as [lng, lat]", () => {
    expect(point(101.7, 3.1)).toEqual({
      type: "Point",
      coordinates: [101.7, 3.1],
    });
  });

  it("parses numeric strings and rejects out-of-range coordinates", () => {
    expect(parseCoordinate("3.14", "latitude")).toBe(3.14);
    expect(() => parseCoordinate("91", "latitude")).toThrow();
    expect(() => parseCoordinate("181", "longitude")).toThrow();
  });

  it("validates closed polygon rings", () => {
    const ring = [
      [
        [0, 0],
        [0, 1],
        [1, 1],
        [0, 0],
      ],
    ];
    expect(polygon(ring)).toEqual({ type: "Polygon", coordinates: ring });
    expect(() =>
      polygon([
        [
          [0, 0],
          [0, 1],
          [1, 1],
        ],
      ]),
    ).toThrow(/closed/);
  });

  it("checks point-in-polygon", () => {
    const square = polygon([
      [
        [0, 0],
        [0, 2],
        [2, 2],
        [2, 0],
        [0, 0],
      ],
    ]);
    expect(containsPoint(square, 1, 1)).toBe(true);
    expect(containsPoint(square, 3, 1)).toBe(false);
  });

  it("computes haversine distance", () => {
    expect(haversineKm(0, 0, 0, 1)).toBeCloseTo(111.19, 1);
  });

  it("normalises opening times to [HH, MM] arrays and evaluates them in a timezone", () => {
    const times = openingTimes([
      {
        day: "THU",
        times: [{ startTime: ["09", "00"], endTime: ["17", "30"] }],
      },
    ]);
    expect(times[0].times[0].startTime).toEqual(["09", "00"]);
    expect(
      isOpenAt(times, new Date("2026-10-08T02:00:00Z"), "Asia/Kuala_Lumpur"),
    ).toBe(true);
    expect(
      isOpenAt(times, new Date("2026-10-08T10:00:00Z"), "Asia/Kuala_Lumpur"),
    ).toBe(false);
  });

  it("accepts HH:MM strings from web forms", () => {
    expect(
      openingTimes([
        { day: "MON", times: [{ startTime: "08:15", endTime: "20:00" }] },
      ])[0].times[0],
    ).toEqual({ startTime: ["08", "15"], endTime: ["20", "00"] });
  });
});

describe("pagination", () => {
  it("defaults to page 1, limit 10 and caps at maxLimit", () => {
    expect(paginate({})).toEqual({ page: 1, limit: 10, skip: 0 });
    expect(paginate({ page: 3, limit: 1000, maxLimit: 100 })).toEqual({
      page: 3,
      limit: 100,
      skip: 200,
    });
  });

  it("shapes P1, P2, P4 and P6 responses", () => {
    const window = paginate({ page: 2, limit: 10 });
    expect(p1(["a"], 21, window)).toEqual({
      data: ["a"],
      totalCount: 21,
      currentPage: 2,
      totalPages: 3,
      nextPage: 3,
      prevPage: 1,
    });
    expect(p2(["o"], 21, window).orders).toEqual(["o"]);
    expect(p4(["t"], 21)).toEqual({
      success: true,
      message: null,
      data: ["t"],
      pagination: { total: 21 },
    });
    expect(p6("tickets", ["x"], 21, window)).toEqual({
      tickets: ["x"],
      docsCount: 21,
      totalPages: 3,
      currentPage: 2,
    });
  });
});
