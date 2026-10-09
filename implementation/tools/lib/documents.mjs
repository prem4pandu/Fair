import ts from "typescript";
import { looksLikeGraphQL } from "./graphql-text.mjs";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import {
  dirname,
  extname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath } from "node:url";

const vendorRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../vendor/enatega-ui",
);
const sourceExtensions = new Set([".js", ".jsx", ".ts", ".tsx"]);
const documentExtensions = new Set([".graphql", ".gql"]);
const skippedDirectories = new Set([
  "node_modules",
  ".next",
  "cypress",
  "__tests__",
]);

const posix = (path) => path.split(sep).join("/");

function inside(root, path) {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== "..");
}

function safeAppRoot(app) {
  if (typeof app !== "string" || !app)
    throw new Error("Path outside vendor/enatega-ui");
  const root = resolve(vendorRoot, app);
  if (!inside(vendorRoot, root))
    throw new Error("Path outside vendor/enatega-ui");
  return root;
}

function safeSourcePath(app, file) {
  const appRoot = safeAppRoot(app);
  if (typeof file !== "string" || isAbsolute(file))
    throw new Error("Path outside vendor/enatega-ui");
  const path = resolve(appRoot, file);
  if (!inside(appRoot, path) || !inside(vendorRoot, path))
    throw new Error("Path outside vendor/enatega-ui");
  return path;
}

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name, "en"))
    .flatMap((entry) => {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory())
        return skippedDirectories.has(entry.name) ? [] : walk(path);
      const extension = extname(entry.name);
      return entry.isFile() &&
        (sourceExtensions.has(extension) || documentExtensions.has(extension))
        ? [path]
        : [];
    });
}

function moduleFile(specifier, importer) {
  if (!specifier.startsWith(".")) return null;
  const base = resolve(dirname(importer), specifier);
  const candidates = [
    base,
    ...[".ts", ".tsx", ".js", ".jsx", ".graphql", ".gql"].map(
      (extension) => `${base}${extension}`,
    ),
    ...[".ts", ".tsx", ".js", ".jsx"].map((extension) =>
      resolve(base, `index${extension}`),
    ),
  ];
  return candidates.find(
    (path) =>
      inside(vendorRoot, path) && existsSync(path) && statSync(path).isFile(),
  );
}

const parsedModules = new Map();
function parseModule(path) {
  if (parsedModules.has(path)) return parsedModules.get(path);
  const raw = readFileSync(path, "utf8");
  const ast = ts.createSourceFile(path, raw, ts.ScriptTarget.Latest, true);
  const declarations = new Map();
  const imports = new Map();
  const exported = new Set();

  for (const statement of ast.statements) {
    if (
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      const target = moduleFile(statement.moduleSpecifier.text, path);
      const clause = statement.importClause;
      if (target && clause?.name)
        imports.set(clause.name.text, { path: target, imported: "default" });
      if (target && clause?.namedBindings) {
        if (ts.isNamespaceImport(clause.namedBindings)) {
          imports.set(clause.namedBindings.name.text, {
            path: target,
            imported: "*",
          });
        } else {
          for (const element of clause.namedBindings.elements)
            imports.set(element.name.text, {
              path: target,
              imported: element.propertyName?.text ?? element.name.text,
            });
        }
      }
    }
    if (ts.isVariableStatement(statement)) {
      const isExported = statement.modifiers?.some(
        (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
      );
      for (const declaration of statement.declarationList.declarations)
        if (ts.isIdentifier(declaration.name) && declaration.initializer) {
          declarations.set(declaration.name.text, declaration.initializer);
          if (isExported) exported.add(declaration.name.text);
        }
    }
    if (ts.isExportDeclaration(statement) && statement.exportClause) {
      for (const element of statement.exportClause.elements)
        exported.add(element.name.text);
    }
    if (ts.isExportAssignment(statement))
      declarations.set("default", statement.expression);
  }
  const parsed = { raw, ast, declarations, imports, exported };
  parsedModules.set(path, parsed);
  return parsed;
}

function gqlCall(node, ast) {
  if (ts.isTaggedTemplateExpression(node))
    return /(?:^|\.)(?:gql|graphql)$/.test(node.tag.getText(ast))
      ? node.template
      : null;
  if (ts.isCallExpression(node))
    return /(?:^|\.)(?:gql|graphql)$/.test(node.expression.getText(ast))
      ? node.arguments[0]
      : null;
  return null;
}

function resolveExpression(path, expression, importDepth, seen) {
  const module = parseModule(path);
  const key = `${path}:${expression.pos}:${expression.end}`;
  if (seen.has(key)) return null;
  const nextSeen = new Set(seen).add(key);
  const wrapped = gqlCall(expression, module.ast);
  if (wrapped) return resolveExpression(path, wrapped, importDepth, nextSeen);
  if (
    ts.isStringLiteral(expression) ||
    ts.isNoSubstitutionTemplateLiteral(expression)
  )
    return { text: expression.text, interpolations: 0 };
  if (ts.isTemplateExpression(expression)) {
    let text = expression.head.text;
    let interpolations = expression.templateSpans.length;
    for (const span of expression.templateSpans) {
      const resolved = resolveExpression(
        path,
        span.expression,
        importDepth,
        nextSeen,
      );
      if (!resolved) return null;
      text += resolved.text + span.literal.text;
      interpolations += resolved.interpolations;
    }
    return { text, interpolations };
  }
  if (ts.isParenthesizedExpression(expression))
    return resolveExpression(
      path,
      expression.expression,
      importDepth,
      nextSeen,
    );
  if (ts.isIdentifier(expression)) {
    const local = module.declarations.get(expression.text);
    if (local) return resolveExpression(path, local, importDepth, nextSeen);
    const imported = module.imports.get(expression.text);
    if (!imported || imported.imported === "*" || importDepth >= 3) return null;
    const target = parseModule(imported.path).declarations.get(
      imported.imported,
    );
    return target
      ? resolveExpression(imported.path, target, importDepth + 1, nextSeen)
      : null;
  }
  if (
    ts.isPropertyAccessExpression(expression) &&
    ts.isIdentifier(expression.expression)
  ) {
    const imported = module.imports.get(expression.expression.text);
    if (!imported || imported.imported !== "*" || importDepth >= 3) return null;
    const target = parseModule(imported.path).declarations.get(
      expression.name.text,
    );
    return target
      ? resolveExpression(imported.path, target, importDepth + 1, nextSeen)
      : null;
  }
  return null;
}

function bindingName(node) {
  let current = node;
  while (current) {
    if (
      ts.isVariableDeclaration(current) &&
      ts.isIdentifier(current.name) &&
      current.initializer &&
      (current.initializer === node ||
        current.initializer.getStart() <= node.getStart())
    )
      return current.name.text;
    current = current.parent;
  }
  return null;
}

function sourceDocuments(path, appRoot) {
  const module = parseModule(path);
  const documents = [];
  const visit = (node) => {
    const wrapped = gqlCall(node, module.ast);
    const literal =
      ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
        ? node
        : ts.isTemplateExpression(node)
          ? node
          : null;
    const expression =
      wrapped ??
      (literal &&
      looksLikeGraphQL(
        ts.isTemplateExpression(literal) ? literal.head.text : literal.text,
      )
        ? literal
        : null);
    if (expression) {
      const result = resolveExpression(path, node, 0, new Set());
      documents.push({
        file: posix(relative(appRoot, path)),
        line:
          module.ast.getLineAndCharacterOfPosition(node.getStart(module.ast))
            .line + 1,
        exportName: bindingName(node),
        text: result?.text ?? node.getText(module.ast),
        interpolations: ts.isTemplateExpression(expression)
          ? expression.templateSpans.length
          : 0,
        resolved: Boolean(result),
      });
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(module.ast);
  return documents;
}

export function listDocuments(app) {
  const appRoot = safeAppRoot(app);
  if (!existsSync(appRoot) || !statSync(appRoot).isDirectory())
    throw new Error(`Unknown Enatega app ${app}`);
  return walk(appRoot).flatMap((path) => {
    if (documentExtensions.has(extname(path)))
      return [
        {
          file: posix(relative(appRoot, path)),
          line: 1,
          exportName: null,
          text: readFileSync(path, "utf8"),
          interpolations: 0,
          resolved: true,
        },
      ];
    return sourceDocuments(path, appRoot);
  });
}

export function loadDocument(app, file, exportName) {
  const path = safeSourcePath(app, file);
  if (!existsSync(path) || !statSync(path).isFile())
    throw new Error(`Unresolved document ${exportName}`);
  if (documentExtensions.has(extname(path))) return readFileSync(path, "utf8");
  const module = parseModule(path);
  if (!module.exported.has(exportName))
    throw new Error(`Unresolved document ${exportName}`);
  const expression = module.declarations.get(exportName);
  const result = expression
    ? resolveExpression(path, expression, 0, new Set())
    : null;
  if (!result || result.text.includes("${"))
    throw new Error(`Unresolved document ${exportName}`);
  return result.text;
}
