#!/usr/bin/env fish

yarn add --dev @yao-pkg/pkg  
yarn run-s sh:build-time compile
yarn pkg . --no-bytecode --options no-deprecation=script,no-warnings=1
yarn remove @yao-pkg/pkg

