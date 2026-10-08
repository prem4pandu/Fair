import { z } from "zod";
const connection = (protocols: string[]) =>
  z.url().refine((value) =>
    (() => {
      try {
        const url = new URL(value);
        if (!url.hostname || url.hash || !protocols.includes(url.protocol))
          return false;
        if (url.protocol.startsWith("redis"))
          return (
            !url.search &&
            (!url.pathname ||
              url.pathname === "/" ||
              (/^\/\d+$/.test(url.pathname) &&
                Number(url.pathname.slice(1)) <= 2147483647))
          );
        return url.pathname.length > 1;
      } catch {
        return false;
      }
    })(),
  );
const schema = z
  .object({
    APP_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    PORT: z.coerce.number().int().min(1).max(65535).default(4100),
    DATABASE_URL: connection(["postgres:", "postgresql:"]),
    REDIS_URL: connection(["redis:", "rediss:"]),
    PASSWORD_AUTH_ENABLED: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    ACCESS_TOKEN_SECRET: z.string().optional(),
    REFRESH_TOKEN_PEPPER: z.string().optional(),
    CORS_ORIGINS: z.string().default(""),
  })
  .superRefine((value, context) => {
    if (value.PASSWORD_AUTH_ENABLED) {
      for (const key of [
        "ACCESS_TOKEN_SECRET",
        "REFRESH_TOKEN_PEPPER",
      ] as const) {
        const secret = value[key];
        if (
          !secret ||
          !/^[A-Za-z0-9_-]{43}$/.test(secret) ||
          Buffer.from(secret, "base64url").length !== 32 ||
          Buffer.from(secret, "base64url").toString("base64url") !== secret
        )
          context.addIssue({
            code: "custom",
            path: [key],
            message: "Canonical 32-byte key required",
          });
      }
      if (value.ACCESS_TOKEN_SECRET === value.REFRESH_TOKEN_PEPPER)
        context.addIssue({
          code: "custom",
          path: ["REFRESH_TOKEN_PEPPER"],
          message: "Keys must differ",
        });
    }
    if (
      value.APP_ENV === "production" &&
      connection(["postgres:", "postgresql:"]).safeParse(value.DATABASE_URL)
        .success &&
      connection(["redis:", "rediss:"]).safeParse(value.REDIS_URL).success
    ) {
      if (new URL(value.REDIS_URL).protocol !== "rediss:")
        context.addIssue({
          code: "custom",
          path: ["REDIS_URL"],
          message: "Verified TLS required",
        });
      const database = new URL(value.DATABASE_URL);
      if (
        database.searchParams.getAll("sslmode").length !== 1 ||
        database.searchParams.get("sslmode") !== "verify-full" ||
        [...database.searchParams.keys()].some(
          (key) =>
            key !== "sslmode" &&
            (key.toLowerCase().startsWith("ssl") ||
              key.toLowerCase() === "uselibpqcompat"),
        )
      )
        context.addIssue({
          code: "custom",
          path: ["DATABASE_URL"],
          message: "Verified TLS required",
        });
    }
  });
export type Config = z.infer<typeof schema> & { origins: string[] };
export function readConfig(env: NodeJS.ProcessEnv): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success)
    throw new Error(
      `Invalid configuration: ${parsed.error.issues.map((issue) => issue.path.join(".")).join(", ")}`,
    );
  const origins = parsed.data.CORS_ORIGINS.split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  for (const origin of origins) {
    let url: URL;
    try {
      url = new URL(origin);
    } catch {
      throw new Error("Invalid CORS_ORIGINS");
    }
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.origin !== origin ||
      (parsed.data.APP_ENV === "production" && url.protocol !== "https:")
    )
      throw new Error("Invalid CORS_ORIGINS");
  }
  return { ...parsed.data, origins };
}
