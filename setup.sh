#!/usr/bin/env bash
yarn;
yarn rebuild;
# yarn unlink fish-langauge-server;
chmod a+x ./out/cli.js
yarn link fish-language-server