// Type declarations for embedded assets namespace
// These modules are handled by the esbuild embed-assets plugin
// Static declarations checked into the repo

// WASM files from npm packages
declare module 'web-tree-sitter/tree-sitter.wasm' {
  const wasmContent: string;
  export default wasmContent;
}

declare module '@esdmr/tree-sitter-fish/tree-sitter-fish.wasm' {
  const wasmContent: string;
  export default wasmContent;
}

// Other embedded assets
declare module '@embedded_assets/tree-sitter-fish.wasm' {
  const wasmContent: string;
  export default wasmContent;
}

declare module '@embedded_assets/tree-sitter.wasm' {
  const wasmContent: string;
  export default wasmContent;
}

declare module '*.wasm' {
  const wasmContent: string;
  export default wasmContent;
}

declare module '@embedded_assets/man/fish-lsp.1' {
  const manContent: string;
  export default manContent;
}

declare module '@embedded_assets/build-time.json' {
  const buildTime: any;
  export default buildTime;
}

declare module '@package' {
  const packageJson: any;
  export default packageJson;
}

declare module '@package.json' {
  const packageJson: any;
  export default packageJson;
}

// Wildcard declaration for all .fish files (relative imports)
declare module '*.fish' {
  const content: string;
  export default content;
}
