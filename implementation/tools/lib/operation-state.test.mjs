import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { implementedRoots } from "./operation-state.mjs";

/**
 * `implementedRoots` decides which root fields have a real resolver. It feeds
 * the derived roadmap/implementation artifacts, so a false positive is a
 * fabricated progress claim: correctness here is not cosmetic. Detection must
 * read the TypeScript syntax tree, never the raw file text.
 */
function fixture(files) {
  const root = mkdtempSync(join(tmpdir(), "operation-state-"));
  const source = join(root, "services", "api", "src", "identity");
  mkdirSync(source, { recursive: true });
  for (const [name, text] of Object.entries(files))
    writeFileSync(join(source, name), text);
  return {
    implementation: root,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function rootsFor(files) {
  const { implementation, cleanup } = fixture(files);
  try {
    return [...implementedRoots({ implementation })].sort();
  } finally {
    cleanup();
  }
}

test("counts a genuine root-field decorator", () => {
  assert.deepEqual(
    rootsFor({
      "identity.resolver.ts": [
        "export class IdentityResolver {",
        '  @Query("emailExist")',
        "  emailExist() {}",
        "",
        '  @Mutation("changePassword")',
        "  changePassword() {}",
        "",
        '  @Subscription("orderStatus")',
        "  orderStatus() {}",
        "}",
      ].join("\n"),
    }),
    ["mutation.changePassword", "query.emailExist", "subscription.orderStatus"],
  );
});

test("ignores decorator-shaped text in comments", () => {
  assert.deepEqual(
    rootsFor({
      "commented.resolver.ts": [
        "export class CommentedResolver {",
        '  // @Query("lineComment")',
        '  /* @Mutation("blockComment") */',
        "  /**",
        '   * @Query("jsdocComment")',
        "   */",
        "  real() {}",
        "}",
      ].join("\n"),
    }),
    [],
  );
});

test("ignores decorator-shaped text inside string literals", () => {
  assert.deepEqual(
    rootsFor({
      "strings.resolver.ts": [
        "export class StringsResolver {",
        "  static example = '@Query(\"inSingleQuotes\")';",
        '  static other = `@Mutation("inTemplate")`;',
        '  @Query("realRoot")',
        "  realRoot() {}",
        "}",
      ].join("\n"),
    }),
    ["query.realRoot"],
  );
});

test("accepts valid formatting the regex-based reader missed", () => {
  assert.deepEqual(
    rootsFor({
      "formatted.resolver.ts": [
        "export class FormattedResolver {",
        "  @Query(",
        '    "multiLine",',
        "  )",
        "  multiLine() {}",
        "",
        '  @Mutation( /* inline */ "spaced" )',
        "  spaced() {}",
        "",
        '  @Query("trailingComma",)',
        "  trailingComma() {}",
        "}",
      ].join("\n"),
    }),
    ["mutation.spaced", "query.multiLine", "query.trailingComma"],
  );
});

test("ignores non-root decorators and non-literal arguments", () => {
  assert.deepEqual(
    rootsFor({
      "other.resolver.ts": [
        "export class OtherResolver {",
        '  @Resolver("identity")',
        "  resolveIt() {}",
        "",
        '  @Field("name")',
        "  name() {}",
        "",
        "  @Query(ROOT_NAME)",
        "  dynamic() {}",
        "",
        '  @Query("with.dots")',
        "  dotted() {}",
        "}",
      ].join("\n"),
    }),
    [],
  );
});

test("deduplicates the same root across files", () => {
  assert.deepEqual(
    rootsFor({
      "a.ts": 'export class A {\n  @Query("shared")\n  shared() {}\n}',
      "b.ts": 'export class B {\n  @Query("shared")\n  shared() {}\n}',
    }),
    ["query.shared"],
  );
});

test("counts only method roots, not class, property or parameter decorations", () => {
  assert.deepEqual(
    rootsFor({
      "shapes.ts": [
        "class PropertyDecorated {",
        '  @Query("propertyDecorated")',
        "  field = 1;",
        "",
        '  @Mutation("realMethod")',
        "  realMethod() {}",
        "}",
        "",
        "class ParameterDecorated {",
        '  method(@Subscription("parameterDecorated") argument: string) {}',
        "}",
      ].join("\n"),
      "class-decorated.ts": [
        '@Query("classDecorated")',
        "class Decorated {",
        "  value() {}",
        "}",
      ].join("\n"),
    }),
    ["mutation.realMethod"],
  );
});

test("documents the argument shapes that are deliberately not resolved", () => {
  // A parenthesised or concatenated argument would need evaluation, which a
  // static inventory must not do. These stay uncounted on purpose: an
  // uncounted root falls back to NOT_IMPLEMENTED, an invented one would be
  // fabricated progress.
  assert.deepEqual(
    rootsFor({
      "arguments.ts": [
        "class ArgumentShapes {",
        '  @Query("plain")',
        "  plain() {}",
        "",
        '  @Query(("parenthesised"))',
        "  parenthesised() {}",
        "",
        '  @Query("con" + "catenated")',
        "  concatenated() {}",
        "}",
      ].join("\n"),
    }),
    ["query.plain"],
  );
});
