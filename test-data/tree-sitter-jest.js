// Jest's module reloading on each tests breaks the tree-sitter module
// So use native require to load `tree-sitter` module only for jest tests
// to prevent module reloading
// @see https://github.com/tree-sitter/node-tree-sitter/issues/181
const { _load } = require("node:module");

module.exports = _load(require.resolve("tree-sitter/index.js"));
