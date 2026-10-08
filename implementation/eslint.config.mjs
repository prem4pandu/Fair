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
    ],
  },
  ...tseslint.configs.recommended,
);
