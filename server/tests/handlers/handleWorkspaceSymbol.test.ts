import {
  MessageConnection,
  SymbolInformation,
  SymbolKind,
  WorkspaceSymbolParams,
  WorkspaceSymbolRequest,
} from 'vscode-languageserver-protocol'
import { getConnections, getDummyContext, getRange } from '../helpers'
import { Context } from '../../src/interfaces'
import { getWorkspaceSymbolHandler } from '../../src/handlers/handleWorkspaceSymbol'
import { initializeParser } from '../../src/parser'

describe('handleWorkspaceSymbol', () => {
  let server: MessageConnection
  let client: MessageConnection
  let context: Context
  let uriA: string
  let uriB: string
  let symbolA: SymbolInformation
  let symbolB: SymbolInformation

  beforeAll(async () => {
    const parser = await initializeParser()
    const connections = getConnections()

    server = connections.server
    client = connections.client

    context = getDummyContext(server, parser)

    const { symbols } = context

    uriA = 'file:///a.awk'
    uriB = 'file:///b.awk'

    symbols[uriA] = new Map()
    symbols[uriB] = new Map()

    symbolA = SymbolInformation.create(
      'func_a',
      SymbolKind.Function,
      getRange(0, 0, 1, 1),
      uriA,
    )

    symbolB = SymbolInformation.create(
      'func_b',
      SymbolKind.Function,
      getRange(0, 0, 1, 1),
      uriB,
    )

    symbols[uriA].set('func_a', [symbolA])
    symbols[uriB].set('func_b', [symbolB])
  })

  it('should provide list of symbols for entire workspace', async () => {
    // Arrange
    const sentParams: WorkspaceSymbolParams = {
      query: 'func',
    }

    server.onRequest(WorkspaceSymbolRequest.type, getWorkspaceSymbolHandler(context))

    // Act
    const result = await client.sendRequest(WorkspaceSymbolRequest.type, sentParams)

    // Assert
    expect(result).toEqual([symbolA, symbolB])
  })
})
