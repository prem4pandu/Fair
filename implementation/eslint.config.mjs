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
      "**/.toolchain/**",
      "**/dist-verified/**",
      "**/dist-native/**",
      "**/playwright-report/**",
      "**/test-results/**",
    ],
  },
  ...tseslint.configs.recommended,
);
