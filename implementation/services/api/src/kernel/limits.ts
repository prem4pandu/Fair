import {
  GraphQLError,
  Kind,
  type FragmentDefinitionNode,
  type SelectionSetNode,
  type ValidationRule,
} from "graphql";

// Sized so the largest pinned Enatega document passes with headroom. The
// compatibility gate verifies every vendored application document against it.
export const LIMITS = {
  depth: 15,
  fields: 600,
  definitions: 60,
  aliases: 30,
} as const;

// The export name and literal LIMITS object are consumed by the compatibility
// checker, so keep this rule statically discoverable.
export const boundedOperation: ValidationRule = (context) => ({
  Document(node) {
    const fragments = new Map<string, FragmentDefinitionNode>();
    for (const definition of node.definitions) {
      if (definition.kind === Kind.FRAGMENT_DEFINITION) {
        fragments.set(definition.name.value, definition);
      }
    }

    let fields = 0;
    let aliases = 0;
    let exceeded = node.definitions.length > LIMITS.definitions;

    const walk = (
      selection: SelectionSetNode,
      depth: number,
      seen: ReadonlySet<string>,
    ): void => {
      if (depth > LIMITS.depth || fields > LIMITS.fields) {
        exceeded = true;
        return;
      }

      for (const entry of selection.selections) {
        if (entry.kind === Kind.FIELD) {
          fields += 1;
          if (entry.alias) aliases += 1;
          if (entry.selectionSet) walk(entry.selectionSet, depth + 1, seen);
        } else if (entry.kind === Kind.INLINE_FRAGMENT) {
          walk(entry.selectionSet, depth, seen);
        } else {
          const name = entry.name.value;
          if (seen.has(name)) {
            exceeded = true;
            return;
          }

          const fragment = fragments.get(name);
          if (fragment) {
            walk(fragment.selectionSet, depth, new Set([...seen, name]));
          }
        }

        if (fields > LIMITS.fields || aliases > LIMITS.aliases) {
          exceeded = true;
          return;
        }
      }
    };

    for (const definition of node.definitions) {
      if (definition.kind !== Kind.OPERATION_DEFINITION) continue;

      if (
        definition.operation === "mutation" &&
        definition.selectionSet.selections.filter(
          (selection) => selection.kind === Kind.FIELD,
        ).length > 1
      ) {
        exceeded = true;
      }
      walk(definition.selectionSet, 1, new Set());
    }

    if (exceeded) {
      context.reportError(new GraphQLError("Operation exceeds allowed limits"));
    }
  },
});
