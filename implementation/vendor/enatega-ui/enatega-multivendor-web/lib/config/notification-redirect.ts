export function normalizeNotificationRedirect(
  candidate: unknown,
  origin: string,
): string | null {
  if (typeof candidate !== "string") return null;

  const value = candidate.trim();
  if (!value || value.startsWith("//")) return null;

  try {
    const base = new URL(origin);
    if (base.protocol !== "http:" && base.protocol !== "https:") return null;

    const target = new URL(value, base);
    if (
      (target.protocol !== "http:" && target.protocol !== "https:") ||
      target.origin !== base.origin
    )
      return null;

    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return null;
  }
}
