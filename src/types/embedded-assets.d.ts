// Type declarations for embedded assets namespace
// These modules are handled by the esbuild embed-assets plugin

// Specific fish file declarations
declare module '@embedded_assets/fish_files/exec.fish' {
  const content: string;
  export default content;
}

declare module '@embedded_assets/fish_files/expand_cartesian.fish' {
  const content: string;
  export default content;
}

declare module '@embedded_assets/fish_files/get-autoloaded-filepath.fish' {
  const content: string;
  export default content;
}

declare module '@embedded_assets/fish_files/get-command-options.fish' {
  const content: string;
  export default content;
}

declare module '@embedded_assets/fish_files/get-completion.fish' {
  const content: string;
  export default content;
}

declare module '@embedded_assets/fish_files/get-dependency.fish' {
  const content: string;
  export default content;
}

declare module '@embedded_assets/fish_files/get-documentation.fish' {
  const content: string;
  export default content;
}

declare module '@embedded_assets/fish_files/get-fish-autoloaded-paths.fish' {
  const content: string;
  export default content;
}

declare module '@embedded_assets/fish_files/get-type-verbose.fish' {
  const content: string;
  export default content;
}

declare module '@embedded_assets/fish_files/get-type.fish' {
  const content: string;
  export default content;
}

// Other embedded assets
declare module '@embedded_assets/tree-sitter-fish.wasm' {
  const wasmContent: string;
  export default wasmContent;
}
//
// Other embedded assets
declare module '@embedded_assets/tree-sitter.wasm' {
  const wasmContent: string;
  export default wasmContent;
}

declare module 'node_modules/web-tree-sitter/tree-sitter.wasm' {
  const wasmContent: string;
  export default wasmContent;
}

declare module '@embedded_assets/package.json' {
  const pkg: any;
  export default pkg;
  export const name: string;
  export const version: string;
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
