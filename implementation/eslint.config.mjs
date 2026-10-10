import tseslint from "typescript-eslint";
export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/.next/**",
      "**/.expo/**",
      "**/generated/**",
      "upstream/**",
      "vendor/**",
      "**/.toolchain/**",
      "**/dist-verified/**",
      "**/dist-native/**",
      "**/dist-identity/**",
      "**/playwright-report/**",
      "**/test-results/**",
      "**/coverage/**",
    ],
  },
  ...tseslint.configs.recommended,
  {
    // Evidence bundles under docs/artifacts may include CommonJS probe fixtures
    // that are loaded with `node --require`. `.cjs` is CommonJS by definition,
    // so require() is the only available import form there; every other lint
    // rule still applies to those files.
    files: ["docs/artifacts/**/*.cjs"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
);
