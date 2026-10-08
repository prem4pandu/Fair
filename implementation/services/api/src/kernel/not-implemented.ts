import type { GraphQLSchema } from "graphql";
import { appError } from "./errors.js";

// Contract fields without an implementation fail explicitly rather than
// returning fabricated data or silently resolving to null.
export function fillNotImplemented(schema: GraphQLSchema): GraphQLSchema {
  for (const type of [schema.getQueryType(), schema.getMutationType()]) {
    for (const field of Object.values(type?.getFields() ?? {})) {
      if (!field.resolve) {
        field.resolve = () => {
          throw appError(
            "NOT_IMPLEMENTED",
            `${field.name} is not available yet`,
          );
        };
      }
    }
  }

  for (const field of Object.values(
    schema.getSubscriptionType()?.getFields() ?? {},
  )) {
    if (!field.subscribe) {
      field.subscribe = () => {
        throw appError("NOT_IMPLEMENTED", `${field.name} is not available yet`);
      };
    }
  }

  return schema;
}
