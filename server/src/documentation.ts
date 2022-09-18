import { readFileSync } from 'fs'

export type Title = string
export type Description = string

export interface Documentation {
  builtins: Record<Title, Description>
  functions: Record<Title, Description>
  io_statements: Record<Title, Description>
  patterns: Record<Title, Description>
  version: string
}

let cachedDocs: Documentation | null = null

export function getDocumentation(): Documentation {
  if (cachedDocs) return cachedDocs

  const json = readFileSync(`${__dirname}/../docs.json`, 'utf8')
  cachedDocs = JSON.parse(json) as Documentation

  return cachedDocs
}

export function dropParamList(fcall: string): string {
  return fcall.replace(/\(.*\)/, '')
}
