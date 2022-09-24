import { accessSync, constants, readdirSync, readFileSync, statSync } from 'fs'
import { URL } from 'url'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { Context } from '../interfaces'
import { isFishExtension } from './tree-sitter'

export function readDocumentFromUrl(context: Context, url: URL): TextDocument | null {
  let content: string

  try {
    content = readFileSync(url, 'utf8')
  } catch (err) {
    const { message, name } = err as Error
    context.connection.console.error(`${name}: ${message}`)
    return null
  }

  return TextDocument.create(url.href, 'fish', 0, content)
}

/** Get files ending with .awk or .gawk recursively */
export function getFishFilesInDir(uri: string): URL[] {
  const result: URL[] = []
  const url = new URL(uri)

  try {
    accessSync(url, constants.R_OK)
  } catch (_err) {
    return []
  }

  for (const dirent of readdirSync(url, { withFileTypes: true })) {
    if (isFishExtension(dirent.name)) {
      result.push(new URL(`${uri}/${dirent.name}`))
      continue
    }

    if (dirent.isDirectory()) {
      result.push(...getFishFilesInDir(`${uri}/${dirent.name}`))
    }
  }

  return result
}
export function isDir(uri: string): boolean {
  return statSync(new URL(uri)).isDirectory()
}
