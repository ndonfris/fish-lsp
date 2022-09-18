import { StreamMessageReader, StreamMessageWriter } from 'vscode-jsonrpc/node'
import {
  createMessageConnection,
  MessageConnection,
  Position,
} from 'vscode-languageserver-protocol'
import { Duplex } from 'stream'
import { Logger, TextDocuments } from 'vscode-languageserver/node'
import { Context, NamespacesByUri } from '../src/interfaces'
import { TextDocument } from 'vscode-languageserver-textdocument'
import * as Parser from 'web-tree-sitter'
import { Range } from 'vscode-languageserver/node'
import { getDocumentation } from '../src/documentation'
import { DependencyMap } from '../src/dependencies'

export class NullLogger implements Logger {
  error(_message: string): void {}
  warn(_message: string): void {}
  info(_message: string): void {}
  log(_message: string): void {}
}

export class TestStream extends Duplex {
  _write(chunk: string, _encoding: string, done: () => void) {
    this.emit('data', chunk)
    done()
  }

  _read(_size: number) {}
}

export function getConnections(): {
  client: MessageConnection
  server: MessageConnection
} {
  const up = new TestStream()
  const down = new TestStream()
  const logger = new NullLogger()

  const client = createMessageConnection(
    new StreamMessageReader(down),
    new StreamMessageWriter(up),
    logger,
  )

  const server = createMessageConnection(
    new StreamMessageReader(up),
    new StreamMessageWriter(down),
    logger,
  )

  client.listen()
  server.listen()

  return { client, server }
}

export function getDummyContext(
  server: MessageConnection,
  parser: Parser,
  connectionProps: { [prop: string]: any } = {},
): Context {
  // These are not present on MessageConnection
  const missingConnectionProperties = {
    console: { log: jest.fn() },
    sendDiagnostics: jest.fn(),
  }

  const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument)

  // Avoid fails on uninitialized namespaces
  const namespaces = new Proxy<NamespacesByUri>(
    {},
    {
      get(ns, prop) {
        // @ts-ignore
        if (typeof prop === 'symbol') return ns[prop]

        if (!ns[prop]) ns[prop] = new Map()

        return ns[prop]
      },
      set(ns, prop, value) {
        // @ts-ignore
        ns[prop] = value
        return true
      },
    },
  )

  return {
    connection: { ...server, ...missingConnectionProperties, ...connectionProps } as any,
    documents,
    capabilities: {},
    parser,
    trees: {},
    symbols: {},
    namespaces,
    dependencies: new DependencyMap(),
    docs: getDocumentation(),
  }
}

export function getRange(
  startLine: number,
  startCharacter: number,
  endLine: number,
  endCharacter: number,
): Range {
  return Range.create(
    Position.create(startLine, startCharacter),
    Position.create(endLine, endCharacter),
  )
}
