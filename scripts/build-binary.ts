#!/usr/bin/env bun

// @ts-ignore
import { $ } from 'bun';
import { join } from 'path';

const targets = [
  'bun-linux-x64',
  'bun-linux-arm64',
  'bun-darwin-x64',
  'bun-darwin-arm64',
] as const;

const assetsToEmbed = [
  'tree-sitter-fish.wasm',
  'fish_files',
  'docs/man/fish-lsp.1',
] as const;

async function buildBinary(target: string): Promise<void> {
  const outName = `fish-lsp-${target.replace('bun-', '')}${target.includes('windows') ? '.exe' : ''}`;

  console.log(`Building ${outName}...`);

  await $`bun build ./out/cli.js \
    --compile \
    --target ${target} \
    --outfile ./build/${outName} \
    --minify`;
}

async function main(): Promise<void> {
  // Ensure dist directory exists
  await $`mkdir -p build`;

  // Build for all targets
  for (const target of targets) {
    await buildBinary(target);
  }

  console.log('✅ All binaries built successfully');
}

main().catch(console.error);
