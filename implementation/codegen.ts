import type { CodegenConfig } from "@graphql-codegen/cli";
const config: CodegenConfig = {
  schema: ["contracts/*.graphql"],
  documents: [],
  generates: {
    "packages/identity-contracts/src/generated.ts": {
      plugins: ["typescript"],
      config: {
        enumsAsTypes: true,
        strictScalars: true,
        scalars: { ID: "string" },
      },
    },
  },
};
export default config;
