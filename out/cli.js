#!/usr/bin/env node
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const minimist_1 = __importDefault(require("minimist"));
const server_1 = require("./server");
function usage(exitCode) {
    console.log('Usage:\n\tfish-language-server [OPTIONS]\n\n' +
        'Options:\n' +
        '\t-h|--help\t\tGet this message\n' +
        '\t-v|--version\t\tGet current version number\n' +
        '\t--noIndex\t\tSkip indexing. Only opened files will be analyzed\n');
    process.exit(exitCode);
}
function printVersion() {
    const packageJson = require('../package.json');
    console.log(packageJson.version);
    process.exit(0);
}
const args = (0, minimist_1.default)(process.argv.slice(2), {
    alias: {
        help: 'h',
        version: 'v',
    },
    default: {
        help: false,
        version: false,
        noIndex: false,
        start: false,
    },
    boolean: ['help', 'version', 'noIndex', 'start'],
    unknown: (key) => {
        if (!key.startsWith('-'))
            return false;
        console.log(`Unknown key: ${key}\n`);
        usage(2);
    },
});
if (args.help)
    usage(0);
if (args.version)
    printVersion();
const options = {
    noIndex: args.noIndex,
};
(0, server_1.main)(options);
// Avoid writing to stdout at this point as it's reserved for client/server communication
//process.stdout.write('Language Server is started.\n')
process.stderr.write('Language Server is started.\n');
//# sourceMappingURL=cli.js.map