import {
  MessageConnection,
  SymbolInformation,
  SymbolKind,
  Range,
  Position,
  CompletionRequest,
  TextDocumentPositionParams,
  CompletionItem,
  CompletionItemKind,
} from 'vscode-languageserver-protocol'
import { getConnections, getDummyContext, getRange } from '../helpers'
import { Context, SymbolsMap } from '../../src/interfaces'
import { getCompletionHandler } from '../../src/handlers/handleCompletion'
import { initCompletionList } from '../../src/completion'
import { getDocumentation } from '../../src/documentation'
import * as Parser from 'web-tree-sitter'

describe('handleCompletion', () => {
  let server: MessageConnection
  let client: MessageConnection
  let uri: string
  let context: Context

  beforeAll(() => {
    const connections = getConnections()

    server = connections.server
    client = connections.client

    context = getDummyContext(server, {} as Parser)

    const { symbols, namespaces, dependencies } = context

    uri = 'file:///my_file.awk'

    dependencies.update(uri, new Set())

    const symbolsMap: SymbolsMap = new Map()

    symbolsMap.set('myFunc', [
      SymbolInformation.create(
        'myFunc',
        SymbolKind.Function,
        Range.create(Position.create(0, 0), Position.create(3, 1)),
        uri,
        'awk',
      ),
    ])

    symbolsMap.set('fn', [
      SymbolInformation.create(
        'fn',
        SymbolKind.Function,
        getRange(5, 0, 5, 17),
        uri,
        'A',
      ),
    ])

    symbols[uri] = symbolsMap

    namespaces[uri].set('A', getRange(5, 0, 50, 0))
  })

  it('should provide completions from current document', async () => {
    // Arrange
    const sentParams: TextDocumentPositionParams = {
      textDocument: { uri },
      position: Position.create(0, 0),
    }

    server.onRequest(CompletionRequest.type, getCompletionHandler(context))

    // Act
    const result = (await client.sendRequest(
      CompletionRequest.type,
      sentParams,
    )) as CompletionItem[]

    // Assert
    const item = CompletionItem.create('myFunc')
    item.kind = CompletionItemKind.Function
    expect(
      result.find((i) => i.kind === item.kind && i.label === item.label),
    ).toMatchObject(item)
  })

  it('should provide completions from included document', async () => {
    // Arrange
    const { dependencies, symbols } = context

    const includedUri = 'file:///somelib.awk'

    dependencies.update(uri, new Set([includedUri]))

    symbols[includedUri] = new Map()
    symbols[includedUri].set('new_func', [
      SymbolInformation.create(
        'new_func',
        SymbolKind.Function,
        getRange(0, 0, 1, 1),
        includedUri,
        'awk',
      ),
    ])

    const sentParams: TextDocumentPositionParams = {
      textDocument: { uri },
      position: Position.create(0, 0),
    }

    server.onRequest(CompletionRequest.type, getCompletionHandler(context))

    // Act
    const result = (await client.sendRequest(
      CompletionRequest.type,
      sentParams,
    )) as CompletionItem[]

    // Assert
    const item = CompletionItem.create('new_func')
    item.kind = CompletionItemKind.Function
    expect(
      result.find((i) => i.kind === item.kind && i.label === item.label),
    ).toMatchObject(item)
  })

  it('should provide completions for builtins', async () => {
    // Arrange
    initCompletionList(getDocumentation())

    const sentParams: TextDocumentPositionParams = {
      textDocument: { uri },
      position: Position.create(0, 0),
    }

    server.onRequest(CompletionRequest.type, getCompletionHandler(context))

    // Act
    const result = (await client.sendRequest(
      CompletionRequest.type,
      sentParams,
    )) as CompletionItem[]

    // Assert
    expect(
      result.find((i) => i.label === 'tolower' && i.kind === CompletionItemKind.Function),
    ).toBeTruthy()
  })

  it('should prepend completions with namespaces', async () => {
    // Arrange
    const sentParams: TextDocumentPositionParams = {
      textDocument: { uri },
      position: Position.create(0, 0),
    }

    server.onRequest(CompletionRequest.type, getCompletionHandler(context))

    // Act
    const result = (await client.sendRequest(
      CompletionRequest.type,
      sentParams,
    )) as CompletionItem[]

    // Assert
    const item = CompletionItem.create('A::fn')
    item.kind = CompletionItemKind.Function
    expect(
      result.find((i) => i.kind === item.kind && i.label === item.label),
    ).toMatchObject(item)
  })

  it('should not prepend completions with namespaces for current namespace', async () => {
    // Arrange
    const sentParams: TextDocumentPositionParams = {
      textDocument: { uri },
      position: Position.create(6, 0),
    }

    server.onRequest(CompletionRequest.type, getCompletionHandler(context))

    // Act
    const result = (await client.sendRequest(
      CompletionRequest.type,
      sentParams,
    )) as CompletionItem[]

    // Assert
    const item = CompletionItem.create('fn')
    item.kind = CompletionItemKind.Function
    expect(
      result.find((i) => i.kind === item.kind && i.label === item.label),
    ).toMatchObject(item)
  })
})
