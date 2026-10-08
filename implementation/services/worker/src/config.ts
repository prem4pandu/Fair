import { z } from "zod";
const protocol = (value: string, allowed: string[]) => {
  try {
    const url = new URL(value);
    if (!url.hostname || url.hash || !allowed.includes(url.protocol))
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
};
const schema = z
  .object({
    APP_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    REDIS_URL: z
      .url()
      .refine((value) => protocol(value, ["redis:", "rediss:"])),
    DATABASE_URL: z
      .url()
      .refine((value) => protocol(value, ["postgres:", "postgresql:"])),
  })
  .superRefine((value, context) => {
    if (value.APP_ENV === "production") {
      if (new URL(value.REDIS_URL).protocol !== "rediss:")
        context.addIssue({
          code: "custom",
          path: ["REDIS_URL"],
          message: "TLS required",
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
          message: "TLS required",
        });
    }
  });
export function readConfig(env: NodeJS.ProcessEnv) {
  const value = schema.safeParse(env);
  if (!value.success)
    throw new Error(
      `Invalid configuration: ${value.error.issues.map((issue) => issue.path.join(".")).join(", ")}`,
    );
  return value.data;
}
