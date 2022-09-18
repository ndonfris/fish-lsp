import {
  execSync,
  ExecSyncOptionsWithStringEncoding,
  spawnSync,
  SpawnSyncOptionsWithStringEncoding,
} from 'child_process'
import { Connection, WorkspaceFolder } from 'vscode-languageserver'
import { fileURLToPath, pathToFileURL } from 'url'
import { resolve } from 'path'

interface PrettierSupportInfo {
  languages: {
    name: string
    extensions: string[]
    parsers: string[]
  }[]
}

let canFormat = false
let prettierDir = ''

export function initFormatter(
  workspaceFolders: WorkspaceFolder[],
  connection: Connection,
) {
  for (const wsf of workspaceFolders) {
    const binDir = resolve(fileURLToPath(wsf.uri), 'node_modules', '.bin')

    if (isAwkPluginAvailable(binDir)) {
      canFormat = true
      prettierDir = binDir
      connection.console.log('Formatter is initialized at: ' + binDir)
      return
    }
  }

  if (isAwkPluginAvailable()) {
    canFormat = true
    connection.console.log('Formatter is initialized globally')
    return
  }

  connection.console.log('No formatter was found')
}

export function isAwkPluginAvailable(binDir?: string): boolean {
  let supportInfoRaw: string

  const options: ExecSyncOptionsWithStringEncoding = {
    encoding: 'utf8',
  }

  if (binDir) {
    // @ts-ignore
    options.cwd = pathToFileURL(binDir)
  }

  try {
    supportInfoRaw = execSync(`prettier --support-info`, options)
  } catch (_err) {
    return false
  }

  const supportInfo = JSON.parse(supportInfoRaw) as PrettierSupportInfo

  return supportInfo.languages.some((l) => l.name.toLocaleLowerCase() === 'awk')
}

export function formatDocument(text: string): string | null {
  if (!canFormat) return null

  const options: SpawnSyncOptionsWithStringEncoding = {
    input: text,
    encoding: 'utf8',
  }

  if (prettierDir) {
    // @ts-ignore
    options.cwd = pathToFileURL(prettierDir)
  }

  const { stdout, status, error } = spawnSync(
    'prettier',
    ['--parser', 'awk-parse', '--loglevel', 'silent'],
    options,
  )

  if (status !== 0) {
    throw new Error('Cannot format document. Make sure there is no syntax error')
  }

  if (error) {
    throw error
  }

  return stdout
}
