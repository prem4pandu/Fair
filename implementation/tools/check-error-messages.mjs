#!/usr/bin/env node
// Static guard for the Enatega client error-message contract.
//
// The customer app treats the message fragments in errors.ts FORBIDDEN_WORDS as
// authentication failures and replays the request, so a business error must never
// contain them. services/api/src/kernel/errors.ts enforces that at runtime for
// appError(); this check proves it statically across every call site before the
// code ever runs, and fails if the runtime list and this check drift apart.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const implementation = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const apiSource = "services/api/src";
const errorsFile = "services/api/src/kernel/errors.ts";

/** Extracts the first string literal of an array declaration, e.g. FORBIDDEN_WORDS. */
function stringArray(text, name) {
  const match = new RegExp(`${name}\\s*=\\s*\\[([\\s\\S]*?)\\]`).exec(text);
  if (!match) return null;
  const values = [...match[1].matchAll(/"([^"]*)"/g)].map((item) => item[1]);
  return values.length ? values : null;
}

/** Extracts `defaults` code -> {status, message} pairs from errors.ts. */
function defaultMessages(text) {
  const block = /const defaults\s*=\s*\{([\s\S]*?)\n\} as const;/.exec(text);
  if (!block) return null;
  const messages = new Map();
  const entry =
    /(\w+):\s*\{\s*status:\s*\d+,\s*message:\s*"((?:[^"\\]|\\.)*)"/g;
  for (const match of block[1].matchAll(entry))
    messages.set(match[1], match[2]);
  return messages.size ? messages : null;
}

/** Codes exempted from the forbidden-word rule (messages clients must recognise). */
function authCodes(text) {
  const block =
    /const authCodes\s*=\s*new Set<ErrorCode>\(\[([\s\S]*?)\]\);/.exec(text);
  if (!block) return null;
  const codes = [...block[1].matchAll(/"([A-Z_]+)"/g)].map((item) => item[1]);
  return codes.length ? new Set(codes) : null;
}

/** Reads balanced arguments of every appError( call in a source file. */
function appErrorCalls(text) {
  const calls = [];
  const marker = /appError\s*\(/g;
  for (const match of text.matchAll(marker)) {
    let index = match.index + match[0].length;
    let depth = 1;
    let quote = null;
    const args = [];
    let current = "";
    for (; index < text.length && depth > 0; index += 1) {
      const character = text[index];
      if (quote) {
        if (character === "\\") {
          current += character + (text[index + 1] ?? "");
          index += 1;
          continue;
        }
        if (character === quote) quote = null;
        current += character;
        continue;
      }
      if (character === '"' || character === "'" || character === "`") {
        quote = character;
        current += character;
        continue;
      }
      if (character === "(") depth += 1;
      if (character === ")") {
        depth -= 1;
        if (depth === 0) break;
      }
      if (character === "," && depth === 1) {
        args.push(current.trim());
        current = "";
        continue;
      }
      current += character;
    }
    if (current.trim()) args.push(current.trim());
    const line = text.slice(0, match.index).split("\n").length;
    calls.push({ line, args });
  }
  return calls;
}

function literal(value) {
  if (typeof value !== "string") return null;
  const quoted = /^"((?:[^"\\]|\\.)*)"$/.exec(value);
  if (quoted) return quoted[1];
  const template = /^`([^`$]*)`$/.exec(value);
  return template ? template[1] : null;
}

function walk(directory) {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name, "en"))
    .flatMap((entry) => {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory())
        return entry.name === "generated" || entry.name === "node_modules"
          ? []
          : walk(target);
      return entry.isFile() && entry.name.endsWith(".ts") ? [target] : [];
    });
}

/**
 * Checks error messages against the runtime contract.
 * Returns {errors, dynamic, checked} and never throws for source problems.
 */
export function checkErrorMessages({
  root = implementation,
  readFile = (file) => fs.readFileSync(file, "utf8"),
  listFiles = (directory) => walk(directory),
} = {}) {
  const errors = [];
  const dynamic = [];
  let source;
  try {
    source = readFile(path.resolve(root, errorsFile));
  } catch {
    return {
      errors: [
        `${errorsFile} is missing; the error contract cannot be verified`,
      ],
      dynamic,
      checked: 0,
      words: [],
    };
  }
  const words = stringArray(source, "FORBIDDEN_WORDS");
  const defaults = defaultMessages(source);
  const auth = authCodes(source);
  if (!words) errors.push(`${errorsFile}: FORBIDDEN_WORDS could not be read`);
  if (!defaults)
    errors.push(`${errorsFile}: default messages could not be read`);
  if (!auth) errors.push(`${errorsFile}: authCodes could not be read`);
  if (errors.length) return { errors, dynamic, checked: 0, words: [] };

  const forbidden = (message) => {
    const lower = message.toLowerCase();
    return words.filter((word) => lower.includes(word));
  };

  for (const [code, message] of defaults)
    if (!auth.has(code) && forbidden(message).length)
      errors.push(
        `${errorsFile}: default ${code} message contains ${forbidden(message).join(", ")}`,
      );

  let checked = 0;
  const directory = path.resolve(root, apiSource);
  for (const file of listFiles(directory)) {
    const relative = path.relative(root, file).split(path.sep).join("/");
    const text = readFile(file);
    if (!text.includes("appError(")) continue;
    for (const call of appErrorCalls(text)) {
      const code = literal(call.args[0]);
      if (!code) {
        dynamic.push(
          `${relative}:${call.line}: appError code is not a literal`,
        );
        continue;
      }
      checked += 1;
      if (!defaults.has(code)) {
        errors.push(`${relative}:${call.line}: unknown error code ${code}`);
        continue;
      }
      const message = call.args[1] === undefined ? null : literal(call.args[1]);
      if (message === null) {
        if (call.args[1] !== undefined)
          dynamic.push(
            `${relative}:${call.line}: ${code} message is not a literal`,
          );
        continue;
      }
      if (auth.has(code)) continue;
      const found = forbidden(message);
      if (found.length)
        errors.push(
          `${relative}:${call.line}: ${code} message contains reserved word(s) ${found.join(", ")}: ${message}`,
        );
    }
  }

  return { errors, dynamic, checked, words };
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const { errors, dynamic, checked, words } = checkErrorMessages();
  const json = process.argv.includes("--json");
  if (json) {
    process.stdout.write(
      `${JSON.stringify({ checked, reservedWords: words, dynamic, errors }, null, 2)}\n`,
    );
  } else if (errors.length) {
    process.stderr.write(`${errors.join("\n")}\n`);
    process.stderr.write(
      `error-message contract FAILED: ${errors.length} violation(s), ${checked} call(s) checked\n`,
    );
  } else {
    process.stdout.write(
      `error-message contract OK: ${checked} appError call(s) checked against ` +
        `${words.length} reserved word(s)` +
        `${dynamic.length ? `; ${dynamic.length} non-literal message(s) not statically verifiable` : ""}\n`,
    );
  }
  process.exit(errors.length ? 1 : 0);
}
