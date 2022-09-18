#!/usr/bin/env node

import * as parseArgs from 'minimist'
import { CliOptions } from './interfaces'
import { main } from './server'

function usage(exitCode: number): never {
  console.log(
    'Usage:\n\tawk-language-server [OPTIONS]\n\n' +
      'Options:\n' +
      '\t-h|--help\t\tGet this message\n' +
      '\t-v|--version\t\tGet current version number\n' +
      '\t--noIndex\t\tSkip indexing. Only opened files will be analyzed\n',
  )

  process.exit(exitCode)
}

function printVersion(): never {
  const packageJson = require('../package.json')

  console.log(packageJson.version)

  process.exit(0)
}

const args = parseArgs(process.argv.slice(2), {
  alias: {
    help: 'h',
    version: 'v',
  },

  default: {
    help: false,
    version: false,
    noIndex: false,
  },

  boolean: ['help', 'version', 'noIndex'],

  unknown: (key: string): boolean => {
    if (!key.startsWith('-')) return false

    console.log(`Unknown key: ${key}\n`)

    usage(2)
  },
})

if (args.help) usage(0)
if (args.version) printVersion()

const options: CliOptions = {
  noIndex: args.noIndex,
}

main(options)

// Avoid writing to stdout at this point as it's reserved for client/server communication
process.stderr.write('Language Server is started.\n')
