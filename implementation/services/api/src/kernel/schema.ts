import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const contracts = new URL("../../../../contracts/", import.meta.url);

// Load Enatega contracts first, followed by the temporary legacy contracts, in
// a stable order. Wave 1 removes the legacy roots after their services have
// been adapted to the Enatega operation names.
export function loadTypeDefs(): string[] {
  const directory = fileURLToPath(new URL("enatega/", contracts));
  const enategaFiles = existsSync(directory)
    ? readdirSync(directory)
        .filter((file) => file.endsWith(".graphql"))
        .sort()
    : [];
  const legacyFiles = [
    "foundation.graphql",
    "identity.graphql",
    "catalog.graphql",
    "addresses.graphql",
    "configuration.graphql",
  ]
    .map((file) => fileURLToPath(new URL(file, contracts)))
    .filter(existsSync);

  return [
    ...enategaFiles.map((file) => readFileSync(join(directory, file), "utf8")),
    ...legacyFiles.map((file) => readFileSync(file, "utf8")),
  ];
}
