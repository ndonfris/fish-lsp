#!/usr/bin/env bash
yarn
yarn build-wasm
yarn compile
yarn link fish-lsp