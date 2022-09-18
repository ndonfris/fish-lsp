import {
  MessageConnection,
  CompletionItem,
  CompletionItemKind,
  CompletionResolveRequest,
  SymbolInformation,
  SymbolKind,
} from 'vscode-languageserver-protocol'
import { getConnections, getDummyContext, getRange } from '../helpers'
import { Context } from '../../src/interfaces'
import { getCompletionResolveHandler } from '../../src/handlers/handleCompletionResolve'
import { UserDefinedDataEntry } from '../../src/completion'
import { initializeParser } from '../../src/parser'
import * as Parser from 'web-tree-sitter'

describe('handleCompletionResolve', () => {
  let server: MessageConnection
  let client: MessageConnection
  let parser: Parser
  let context: Context

  beforeAll(async () => {
    parser = await initializeParser()

    const connections = getConnections()

    server = connections.server
    client = connections.client

    context = getDummyContext(server, parser)
  })

  it('should provide details for builtins', async () => {
    // Arrange
    const sentParams: CompletionItem = {
      label: 'tolower',
      kind: CompletionItemKind.Function,
      data: 'functions.tolower(str)',
    }

    server.onRequest(CompletionResolveRequest.type, getCompletionResolveHandler(context))

    // Act
    const result = await client.sendRequest(CompletionResolveRequest.type, sentParams)

    // Assert
    expect(result.detail).toEqual('tolower(str)')
    expect(result.documentation).toEqual(context.docs.functions['tolower(str)'])
  })

  it('should provide details for user defined symbols', async () => {
    // Arrange
    const dummyFuncDefinition = 'function myFunc(a) {}'
    const uri = 'file:///my_file.awk'
    const symbolInfo = SymbolInformation.create(
      'myFunc',
      SymbolKind.Function,
      getRange(0, 0, 0, dummyFuncDefinition.length),
      uri,
    )

    context.trees[uri] = parser.parse(dummyFuncDefinition)

    const sentParams: CompletionItem = {
      label: 'tolower',
      kind: CompletionItemKind.Function,
      data: {
        type: 'user_defined',
        symbolInfo,
      } as UserDefinedDataEntry,
    }

    server.onRequest(CompletionResolveRequest.type, getCompletionResolveHandler(context))

    // Act
    const result = await client.sendRequest(CompletionResolveRequest.type, sentParams)

    // Assert
    expect(result.detail).toEqual('myFunc(a)')
  })
})
