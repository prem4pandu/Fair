/**
 * Reviewer-owned adversarial fixtures for T-026C (task-4 / w25-review).
 * Not derived from the owner's spec: each case is annotated with what a
 * "root field with a real resolver" should mean, so the observation can be
 * scored as false positive / false negative rather than "matches the code".
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { implementedRoots } from "../../../../../tools/lib/operation-state.mjs";

const root = mkdtempSync(join(tmpdir(), "w25-review-ast-"));
const source = join(root, "services", "api", "src", "adversarial");
mkdirSync(source, { recursive: true });

const file = [
  "/*",
  ' * @Query("blockCommentMultiLine")',
  ' * /* @Mutation("nestedCommentText") */',
  " */",
  "export class Adversarial {",
  "  // decorator-shaped text in a template literal (with and without substitution)",
  '  templateText = `@Query("inTemplateText") and ${"@Mutation(\\"inSubstitution\\")"}`;',
  "  // decorator-shaped text in plain string literals",
  '  single = \'@Query("inSingle")\';',
  '  double = "@Mutation(\\"inDouble\\")";',
  "",
  "  // escaped quote inside the argument of a REAL decorator (invalid field name)",
  '  @Query("esc\\"aped")',
  "  escaped() {}",
  "",
  "  // parenthesised argument of a REAL decorator (semantically @Query(\"parenthesised\"))",
  '  @Query(("parenthesised"))',
  "  parenthesised() {}",
  "",
  "  // concatenated argument of a REAL decorator (semantically @Query(\"concatenated\"))",
  '  @Query("con" + "catenated")',
  "  concatenated() {}",
  "",
  "  // decorator on a class PROPERTY, not a resolver method",
  '  @Query("propertyDecorated")',
  "  someProperty = 1;",
  "",
  "  // genuine resolver fields",
  '  @Query("emailExist")',
  "  emailExist() {}",
  '  @Mutation("changePassword")',
  "  changePassword() {}",
  "",
  "  // extra arguments: @Query(name, options) is a real NestJS resolver form",
  '  @Query("firstArg", { name: "second" })',
  "  extraArgs() {}",
  "",
  "  // no-substitution template literal argument",
  "  @Query(`templateArg`)",
  "  templateArg() {}",
  "}",
  "",
  "// decorator on a class declaration, not a resolver",
  '@Query("classDecorated")',
  "export class DecoratedClass {}",
  "",
  "// decorator on a parameter, not a resolver",
  "export class Param {",
  '  method(@Query("parameterDecorated") p: string) { return p; }',
  "}",
  "",
].join("\n");
writeFileSync(join(source, "adversarial.ts"), file);

const observed = [...implementedRoots({ implementation: root })].sort();
console.log("fixture file written to", join(source, "adversarial.ts"));
console.log("observed keys:", JSON.stringify(observed, null, 2));
const expect = (key, shouldExist, why) => {
  const present = observed.includes(key);
  console.log(
    `${present === shouldExist ? "OK      " : "MISMATCH"} ${present ? "counted " : "absent  "} ${key}  (${shouldExist ? "should be counted" : "should NOT be counted"}: ${why})`,
  );
};
console.log("\n-- scoring --");
expect("query.blockCommentMultiLine", false, "text inside a block comment");
expect("mutation.nestedCommentText", false, "text inside a nested comment region");
expect("query.inTemplateText", false, "decorator-shaped text inside a template literal");
expect("mutation.inSubstitution", false, "decorator-shaped text inside a template substitution string");
expect("query.inSingle", false, "decorator-shaped text inside a single-quoted string");
expect("mutation.inDouble", false, "decorator-shaped text inside a double-quoted string");
expect("query.esc\"aped", false, "escaped quote makes an invalid field name");
expect("query.parenthesised", true, "parenthesised string argument is a real resolver registration");
expect("query.concatenated", true, "statically concatenated string is a real resolver registration");
expect("query.propertyDecorated", false, "decorator on a class property is not a root resolver");
expect("query.classDecorated", false, "decorator on a class declaration is not a root resolver");
expect("query.parameterDecorated", false, "decorator on a parameter is not a root resolver");
expect("query.emailExist", true, "genuine @Query method; name case must be preserved");
expect("mutation.changePassword", true, "genuine @Mutation method; kind must be lowercased");
expect("query.templateArg", true, "no-substitution template literal is a genuine string-like argument");
expect("query.firstArg", true, "@Query(name, options) is a real NestJS resolver form");
console.log("\n(raw observed set for the record):", observed.join(", "));
rmSync(root, { recursive: true, force: true });
