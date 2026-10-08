// Tags a describe block with the root operation it exercises. The operation
// evidence checker reads this stable marker directly from the test source.
export const op = (
  name: `${"query" | "mutation" | "subscription"}.${string}`,
) => `[op:${name}]`;
