import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const contracts = new URL("../../../../contracts/", import.meta.url);

const EXCLUDED_ENATEGA_CONTRACTS = new Set([
  // Superseded by core.graphql. Loading both defines the kernel roots twice.
  "kernel.graphql",
]);

// These schemas back implemented roots whose names do not collide with the
// Enatega contract. configuration.graphql is deliberately absent: its two root
// fields are defined by L2 with the frontend's response types.
const COMPATIBLE_LEGACY_CONTRACTS = [
  "foundation.graphql",
  "identity.graphql",
  "catalog.graphql",
  "addresses.graphql",
];

// Load the complete Enatega contract — including the L12 single-vendor
// declarations, which are served for contract completeness and return the
// explicit NOT_IMPLEMENTED fallback until Wave 5 activates their business
// behavior — plus only non-conflicting implemented legacy roots in a stable
// order.
export function loadTypeDefs(): string[] {
  const directory = fileURLToPath(new URL("enatega/", contracts));
  const enategaFiles = existsSync(directory)
    ? readdirSync(directory)
        .filter(
          (file) =>
            file.endsWith(".graphql") && !EXCLUDED_ENATEGA_CONTRACTS.has(file),
        )
        .sort()
    : [];
  const legacyFiles = COMPATIBLE_LEGACY_CONTRACTS.map((file) =>
    fileURLToPath(new URL(file, contracts)),
  ).filter(existsSync);

  return [
    ...enategaFiles.map((file) => readFileSync(join(directory, file), "utf8")),
    ...legacyFiles.map((file) => readFileSync(file, "utf8")),
  ];
}
