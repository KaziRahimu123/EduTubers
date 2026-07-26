import { defineConfig, globalIgnores } from "eslint/config";

const eslintConfig = defineConfig([
  globalIgnores([
    "**/*",
  ]),
]);

export default eslintConfig;
