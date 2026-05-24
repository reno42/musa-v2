import figmaPlugin from "@figma/eslint-plugin-figma-plugins";

export default [
  {
    files: ["**/*.js"],
    plugins: {
      "@figma/figma-plugins": figmaPlugin,
    },
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: "script",
      globals: {
        figma: "readonly",
        __html__: "readonly",
        __uiFiles__: "readonly",
        console: "readonly",
        setTimeout: "readonly",
        Promise: "readonly",
        Date: "readonly",
        Math: "readonly",
        Array: "readonly",
        Object: "readonly",
        JSON: "readonly",
        Error: "readonly",
      },
    },
    rules: {
      "no-unused-vars": "warn",
      "no-redeclare": "error",
      "eqeqeq": ["error", "always"],
    },
  },
];
