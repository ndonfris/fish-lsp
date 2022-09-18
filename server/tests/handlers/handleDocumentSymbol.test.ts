import {
  DocumentSymbolRequest,
  MessageConnection,
  SymbolInformation,
  SymbolKind,
  Range,
  Position,
} from 'vscode-languageserver-protocol'
import { DocumentSymbolParams } from 'vscode-languageserver-protocol/node'
import { getConnections, getDummyContext } from '../helpers'
import { Context, SymbolsMap } from '../../src/interfaces'
import { getDocumentSymbolHandler } from '../../src/handlers/handleDocumentSymbol'
import { initializeParser } from '../../src/parser'

describe('handleDocumentSymbol', () => {
  let server: MessageConnection
  let client: MessageConnection
  let context: Context

  beforeAll(async () => {
    const parser = await initializeParser()
    const connections = getConnections()

    server = connections.server
    client = connections.client

    context = getDummyContext(server, parser)
  })

  it('should provide list of symbols from current document', async () => {
    // Arrange
    const uri = 'file:///my_file.awk'
    const symbolsMap: SymbolsMap = new Map()
    const symbolInfo = SymbolInformation.create(
      'myFunc',
      SymbolKind.Function,
      Range.create(Position.create(0, 0), Position.create(3, 1)),
    )

    symbolsMap.set('myFunc', [symbolInfo])

    context.symbols[uri] = symbolsMap

    const sentParams: DocumentSymbolParams = {
      textDocument: { uri },
    }

    server.onRequest(DocumentSymbolRequest.type, getDocumentSymbolHandler(context))

    // Act
    const result = await client.sendRequest(DocumentSymbolRequest.type, sentParams)

    // Assert
    expect(result).toEqual([symbolInfo])
  })
})
