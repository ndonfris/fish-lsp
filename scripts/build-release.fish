#!/usr/bin/env fish

yarn add --dev @yao-pkg/pkg  
# yarn add --dev @babel/runtime
yarn run-s sh:build-time compile sh:build-wasm
yarn pkg . --no-bytecode --options no-deprecation=script,no-warnings=1 --public --public-packages "*"
yarn remove @yao-pkg/pkg