import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { format } from "prettier";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const laneFiles = {
  core: "core.graphql",
  L1: "L1-identity.graphql",
  L2: "L2-platform.graphql",
  L3: "L3-vendors-catalog.graphql",
  L4: "L4-customers-support.graphql",
  L5: "L5-orders.graphql",
  L6: "L6-dispatch.graphql",
  L7: "L7-finance.graphql",
  L8: "L8-notifications.graphql",
  L9: "L9-analytics.graphql",
  L12: "L12-single-vendor.graphql",
};
const builtins = new Set(["Int", "Float", "String", "Boolean", "ID"]);

const pascal = (value) =>
  value
    .replace(/[^A-Za-z0-9]+/g, " ")
    .replace(/(^|\s)([A-Za-z0-9])/g, (_, __, letter) => letter.toUpperCase())
    .replace(/\s/g, "") || "Value";
const singular = (name) =>
  name.endsWith("ies")
    ? `${name.slice(0, -3)}y`
    : name.endsWith("sses")
      ? name.slice(0, -2)
      : name.endsWith("s") && !name.endsWith("ss")
        ? name.slice(0, -1)
        : name;
const namedType = (type) => type.replace(/[\[\]!]/g, "");

function leastStrict(types, review, context) {
  if (!types.length) return null;
  const nullableShapes = types.map((type) => type.replaceAll("!", ""));
  if (nullableShapes.some((type) => type !== nullableShapes[0])) {
    review.push(`${context}: incompatible argument types ${types.join(", ")}`);
    return types[0].replace(/!+$/g, "");
  }
  return nullableShapes[0];
}

function literalType(rootName, argumentName, argument, declarations) {
  if (argument.literalKinds.includes("EnumValue")) {
    const name = `${pascal(rootName)}${pascal(argumentName)}`;
    declarations.enums.set(
      name,
      argument.enumValues.length ? argument.enumValues : ["UNKNOWN"],
    );
    return name;
  }
  if (argument.literalKinds.includes("ObjectValue")) {
    const name = `${pascal(rootName)}${pascal(argumentName)}Input`;
    declarations.inputs.set(name, argument.objectFieldTypes);
    return name;
  }
  const map = {
    IntValue: "Int",
    FloatValue: "Float",
    StringValue: "String",
    BooleanValue: "Boolean",
  };
  return map[argument.literalKinds[0]] ?? "String";
}

function leafType(name, parentType, review, context) {
  if (name === "coordinates" && parentType === "Location") return "[Float]";
  if (name === "coordinates" && parentType === "Polygon") return "[[[Float]]]";
  if (["startTime", "endTime"].includes(name) && parentType === "Timings")
    return "[String]";
  if (
    name === "_id" ||
    name === "id" ||
    (/Id$/.test(name) && name !== "orderId")
  )
    return "ID";
  if (
    /^(is|has)/.test(name) ||
    /Enabled$/.test(name) ||
    [
      "available",
      "emailExist",
      "enabled",
      "phoneExist",
      "selected",
      "success",
    ].includes(name)
  )
    return "Boolean";
  if (
    /^(count|quantity|page|limit|version|docsCount|distanceMeters|durationSeconds)$/.test(
      name,
    ) ||
    /(Count|Pages)$/.test(name) ||
    /^total(Count|Pages|Docs)/.test(name)
  )
    return "Int";
  if (
    /price|amount|charges|tipping|tax|minimumOrder|rating|commissionRate|deliveryRate|wallet|discount|latitude|longitude|accuracy|heading|speed/i.test(
      name,
    )
  )
    return "Float";
  if (/^(permissions|cuisines|tags)$/.test(name) || /Ids$/.test(name))
    return "[String]";
  review.push(`${context}: defaulted leaf ${name} to String`);
  return "String";
}

function typeOverride(typeMap, context, parentType, fieldName) {
  return (
    typeMap.typeOverrides?.[context] ??
    (parentType && fieldName
      ? typeMap.typeOverrides?.[`${parentType}.${fieldName}`]
      : undefined)
  );
}

function looksLikeCollection(name) {
  return (
    name === "data" ||
    [
      "addresses",
      "addons",
      "banners",
      "categories",
      "cities",
      "countries",
      "cuisines",
      "foods",
      "messages",
      "offers",
      "openingTimes",
      "options",
      "restaurants",
      "reviews",
      "sections",
      "staffs",
      "subCategories",
      "tickets",
      "users",
      "variations",
      "vendors",
      "zones",
    ].includes(name)
  );
}

function inferredOwnership(typeName, rootLane, typeMap) {
  if (typeMap.ownership[typeName]) return typeMap.ownership[typeName];
  const patterns = [
    [/^(User|Owner|Staff|Auth|Login)/, "L1"],
    [
      /^(Configuration|Zone|Polygon|Cuisine|ShopType|Banner|Tipping|Taxation|Version|Country|City|AuditLog|Upload)/,
      "L2",
    ],
    [
      /^(Restaurant|Vendor|Food|Variation|Addon|Option|Category|SubCategory|Coupon|Review|OpeningTimes|Timings|Bussiness)/,
      "L3",
    ],
    [/^(Address|SupportTicket|TicketMessage)/, "L4"],
    [/^Order/, "L5"],
    [/^(Rider|ChatMessage|Tracking|LiveMonitor)/, "L6"],
    [
      /^(Earnings|Transaction|WithdrawRequest|CommissionRate|EarningsGraph)/,
      "L7",
    ],
    [/^(Notification|WebNotification)/, "L8"],
    [/^Dashboard/, "L9"],
  ];
  return patterns.find(([pattern]) => pattern.test(typeName))?.[1] ?? rootLane;
}

function objectType(rootKind, rootName, path, fieldName, node, typeMap) {
  const key = [rootKind, rootName, ...path, fieldName].join(".");
  if (typeMap.byPath[key]) return typeMap.byPath[key];
  if (node.typeConditions.length) return node.typeConditions[0];
  const mapped =
    typeMap.byFieldName[fieldName] ?? typeMap.byFieldName[singular(fieldName)];
  if (mapped) return mapped;
  return `${pascal(rootName)}${[...path, fieldName].map(pascal).join("")}`;
}

export function generate(requirements, typeMap, lanes) {
  const review = [];
  const declarations = {
    objects: new Map(),
    objectLanes: new Map(),
    inputs: new Map(),
    enums: new Map(),
    scalars: new Set(),
  };
  const roots = new Map(
    Object.keys(laneFiles).map((lane) => [lane, new Map()]),
  );
  const laneByRoot = new Map(
    lanes.operations.map((operation) => [
      `${operation.type}:${operation.name}`,
      operation.lane === "L0" ? "core" : operation.lane,
    ]),
  );

  const addObject = (typeName, node, rootKind, rootName, path, lane) => {
    const fields = declarations.objects.get(typeName) ?? new Map();
    declarations.objects.set(typeName, fields);
    declarations.objectLanes.set(
      typeName,
      declarations.objectLanes.get(typeName) ?? lane,
    );
    for (const [fieldName, child] of Object.entries(node.fields)) {
      let type;
      const context = `${rootKind}.${rootName}.${[...path, fieldName].join(".")}`;
      const override = typeOverride(typeMap, context, typeName, fieldName);
      if (Object.keys(child.fields).length) {
        type =
          override ??
          (fieldName === "addons" && typeName === "OrderItem"
            ? "OrderItemAddon"
            : objectType(rootKind, rootName, path, fieldName, child, typeMap));
        const existing = fields.get(fieldName);
        addObject(
          namedType(existing && existing !== type ? existing : type),
          child,
          rootKind,
          rootName,
          [...path, fieldName],
          lane,
        );
        if (!override && looksLikeCollection(fieldName))
          review.push(
            `${context}: unresolved cardinality for object selection`,
          );
      } else type = override ?? leafType(fieldName, typeName, review, context);
      const existing = fields.get(fieldName);
      if (existing && existing !== type)
        review.push(
          `${typeName}.${fieldName}: conflicting ${existing} and ${type}`,
        );
      else fields.set(fieldName, type);
    }
  };

  for (const rootKind of ["query", "mutation", "subscription"]) {
    for (const [rootName, requirement] of Object.entries(
      requirements[rootKind],
    )) {
      if (rootName === "metricsGeneral") continue;
      const lane = laneByRoot.get(`${rootKind}:${rootName}`);
      if (!lane) throw new Error(`No lane for ${rootKind}.${rootName}`);
      const args = [];
      for (const [argumentName, argument] of Object.entries(
        requirement.arguments,
      )) {
        const variableType = leastStrict(
          argument.variableTypes,
          review,
          `${rootKind}.${rootName}.${argumentName}`,
        );
        const type =
          typeMap.argumentOverrides?.[
            `${rootKind}.${rootName}.${argumentName}`
          ] ??
          variableType ??
          literalType(rootName, argumentName, argument, declarations);
        args.push(`${argumentName}: ${type}`);
        const name = namedType(type);
        if (!builtins.has(name) && !name.endsWith("Input"))
          declarations.scalars.add(name);
      }
      const hasSelection = Object.keys(requirement.selection.fields).length > 0;
      const rootOverride = typeOverride(
        typeMap,
        `${rootKind}.${rootName}`,
        null,
        null,
      );
      const returnType = hasSelection
        ? (rootOverride ??
          objectType(
            rootKind,
            rootName,
            [],
            rootName,
            requirement.selection,
            typeMap,
          ))
        : leafType(rootName, "Root", review, `${rootKind}.${rootName}`);
      if (hasSelection)
        addObject(
          namedType(returnType),
          requirement.selection,
          rootKind,
          rootName,
          [],
          lane,
        );
      if (hasSelection && !rootOverride && looksLikeCollection(rootName))
        review.push(`${rootKind}.${rootName}: unresolved root cardinality`);
      const byKind = roots.get(lane);
      const entries = byKind.get(rootKind) ?? [];
      entries.push(
        `${rootName}${args.length ? `(${args.join(", ")})` : ""}: ${returnType}`,
      );
      byKind.set(rootKind, entries);
    }
  }
  for (const inputName of Object.keys(requirements.inputs))
    if (!declarations.inputs.has(inputName))
      declarations.inputs.set(inputName, {});
  for (const rootKind of ["query", "mutation", "subscription"])
    for (const requirement of Object.values(requirements[rootKind]))
      for (const argument of Object.values(requirement.arguments)) {
        const inputName = argument.variableTypes
          .map(namedType)
          .find((name) => name.endsWith("Input"));
        if (inputName && argument.objectKeys.length) {
          const fields = declarations.inputs.get(inputName) ?? {};
          declarations.inputs.set(inputName, {
            ...fields,
            ...argument.objectFieldTypes,
          });
        }
      }
  for (const [inputName, fields] of Object.entries(
    typeMap.inputOverrides ?? {},
  ))
    declarations.inputs.set(inputName, fields);
  for (const type of declarations.objects.keys())
    declarations.scalars.delete(type);
  for (const type of declarations.inputs.keys())
    declarations.scalars.delete(type);
  for (const type of declarations.enums.keys())
    declarations.scalars.delete(type);

  const sections = new Map(Object.keys(laneFiles).map((lane) => [lane, []]));
  sections
    .get("core")
    .push(
      "directive @client on FIELD",
      "type MetricsGeneral { excellence: String topgun: String experience: String! skydiver: String rider: String haha: String hehe: String! huhu: String yoyo: String turu: String }",
      "type Query { _kernel: String }",
      "type Mutation { metricsGeneral: MetricsGeneral! }",
      "type Subscription { _kernel: String }",
    );
  for (const scalar of [...declarations.scalars].sort())
    sections.get("core").push(`scalar ${scalar}`);
  for (const [name, values] of [...declarations.enums].sort(([a], [b]) =>
    a.localeCompare(b),
  ))
    sections.get("core").push(`enum ${name} { ${values.join(" ")} }`);
  for (const [name, fields] of [...declarations.inputs].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const entries = Object.entries(fields);
    const exactInput = Object.hasOwn(typeMap.inputOverrides ?? {}, name);
    sections
      .get("core")
      .push(
        `input ${name} { ${entries.length ? entries.map(([field, type]) => `${field}: ${exactInput ? type : type.replace(/!+$/g, "")}`).join(" ") : "_unused: String"} }`,
      );
  }
  for (const [name, fields] of [...declarations.objects].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const rootLane = declarations.objectLanes.get(name) ?? "core";
    const lane = inferredOwnership(name, rootLane, typeMap);
    const body = [...fields.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([field, type]) => `${field}: ${type}`)
      .join(" ");
    sections
      .get(lane)
      ?.push(`type ${name} { ${body || "_placeholder: String"} }`);
  }
  for (const [lane, kinds] of roots)
    for (const [kind, fields] of kinds)
      sections
        .get(lane)
        .push(`extend type ${pascal(kind)} { ${fields.sort().join(" ")} }`);
  const files = Object.fromEntries(
    Object.entries(laneFiles).map(([lane, filename]) => [
      filename,
      `# Generated from pinned Enatega documents. Lane owners refine this schema.\n\n${sections.get(lane).join("\n\n") || `scalar ${lane}DeferredContract`}\n`,
    ]),
  );
  // A lane the requirements say nothing about must never overwrite an existing
  // hand-curated contract with a DeferredContract placeholder.
  const emptyLanes = new Set(
    Object.keys(laneFiles).filter((lane) => sections.get(lane).length === 0),
  );
  return { files, review: [...new Set(review)].sort(), emptyLanes };
}

export async function run() {
  const requirements = JSON.parse(
    readFileSync(resolve(root, "docs/ENATEGA_TYPE_REQUIREMENTS.json")),
  );
  const typeMap = JSON.parse(
    readFileSync(resolve(root, "tools/type-map.json")),
  );
  const lanes = JSON.parse(
    readFileSync(resolve(root, "docs/OPERATION_LANES.json")),
  );
  const result = generate(requirements, typeMap, lanes);
  result.preserved = [];
  for (const [lane, filename] of Object.entries(laneFiles)) {
    const target = resolve(root, "contracts/enatega", filename);
    if (result.emptyLanes.has(lane) && existsSync(target)) {
      result.preserved.push(filename);
      continue;
    }
    writeFileSync(
      target,
      await format(result.files[filename], { parser: "graphql" }),
    );
  }
  if (result.preserved.length)
    console.warn(
      `Preserved existing contracts with no generated content: ${result.preserved.join(", ")}`,
    );
  writeFileSync(
    resolve(root, "docs/SDL_TYPE_REVIEW.md"),
    await format(
      `# SDL type review\n\n${result.review.map((item) => `- ${item}`).join("\n")}\n`,
      { parser: "markdown" },
    ),
  );
  return result;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await run();
