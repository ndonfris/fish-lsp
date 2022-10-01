#!/usr/bin/env node
/* eslint-disable no-console */

//const package = require('../package')

const args = process.argv

const start = args.find((s) => s == 'start')
//const version = args.find((s) => s == '-v' || s == '--version')
const help = args.find((s) => s == '-h' || s == '--help')

if (start) {
  require('../out/fish-lsp-server')
} else if (help) {
  console.log(`
Usage:
  fish-language-server start
  fish-language-server -h | --help
  fish-language-server -v | --version
  `)
} else {
  const command = args.join(' ')
  console.error(`Unknown command '${command}'. Run with -h for help.`)
}
