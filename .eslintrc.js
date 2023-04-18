module.exports = {
  env: {
    es6: true,
    node: true,
    mocha: true,
  },
  plugins: ["@typescript-eslint"],
  extends: [
    "standard",
    "plugin:@typescript-eslint/recommended",
    "plugin:prettier/recommended",
  ],
  parser: "@typescript-eslint/parser",
};
