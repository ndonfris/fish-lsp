import {
  MessageConnection,
  SymbolInformation,
  SymbolKind,
  Position,
  HoverParams,
  HoverRequest,
  MarkupContent,
} from 'vscode-languageserver-protocol'
import { getConnections, getDummyContext, getRange } from '../helpers'
import { Context } from '../../src/interfaces'
import { getHoverHandler } from '../../src/handlers/handleHover'
import { initializeParser } from '../../src/parser'
import { readFileSync } from 'fs'
import { join } from 'path'

describe('handleHover', () => {
  let server: MessageConnection
  let client: MessageConnection
  let context: Context
  let uriA: string
  let uriB: string
  let uriC: string

  beforeAll(async () => {
    const parser = await initializeParser()
    const connections = getConnections()

    server = connections.server
    client = connections.client

    context = getDummyContext(server, parser)

    const { trees, symbols, namespaces, dependencies } = context

    const contentA = readFileSync(
      join('server', 'tests', 'handlers', 'fixtures', 'hover_a.awk'),
      'utf8',
    )
    const contentB = readFileSync(
      join('server', 'tests', 'handlers', 'fixtures', 'hover_b.awk'),
      'utf8',
    )
    const contentC = readFileSync(
      join('server', 'tests', 'handlers', 'fixtures', 'hover_c.awk'),
      'utf8',
    )

    uriA = 'file:///a.awk'
    uriB = 'file:///b.awk'
    uriC = 'file:///c.awk'

    trees[uriA] = parser.parse(contentA)
    trees[uriB] = parser.parse(contentB)
    trees[uriC] = parser.parse(contentC)

    dependencies.update(uriA, new Set([uriB, uriC]))

    symbols[uriA] = new Map()
    symbols[uriB] = new Map()

    symbols[uriA].set('f', [
      SymbolInformation.create(
        'f',
        SymbolKind.Function,
        getRange(3, 0, 3, 16),
        uriA,
        'awk',
      ),
    ])

    symbols[uriA].set('str', [
      SymbolInformation.create(
        'str',
        SymbolKind.Variable,
        getRange(6, 4, 6, 26),
        uriA,
        'awk',
      ),
    ])

    symbols[uriA].set('x', [
      SymbolInformation.create(
        'x',
        SymbolKind.Variable,
        getRange(15, 4, 15, 10),
        uriA,
        'A',
      ),
    ])

    symbols[uriA].set('fn', [
      SymbolInformation.create(
        'fn',
        SymbolKind.Function,
        getRange(20, 0, 20, 17),
        uriA,
        'A',
      ),
    ])

    symbols[uriB].set('sum', [
      SymbolInformation.create(
        'sum',
        SymbolKind.Function,
        getRange(1, 0, 3, 1),
        uriB,
        'awk',
      ),
    ])

    symbols[uriB].set('var_b', [
      SymbolInformation.create(
        'var_b',
        SymbolKind.Function,
        getRange(6, 4, 6, 14),
        uriB,
        'awk',
      ),
    ])

    symbols[uriB].set('x', [
      SymbolInformation.create(
        'x',
        SymbolKind.Function,
        getRange(11, 8, 11, 14),
        uriB,
        'B',
      ),
    ])

    symbols[uriB].set('fn', [
      SymbolInformation.create(
        'fn',
        SymbolKind.Function,
        getRange(13, 0, 13, 17),
        uriB,
        'B',
      ),
    ])

    namespaces[uriA] = new Map()
    namespaces[uriB] = new Map()

    namespaces[uriA].set('A', getRange(12, 14, 27, 0))
    namespaces[uriB].set('B', getRange(9, 14, 15, 0))
  })

  it('should provide hint for builtin functions', async () => {
    // Arrange
    const sentParams: HoverParams = {
      textDocument: { uri: uriA },
      position: Position.create(6, 10),
    }

    server.onRequest(HoverRequest.type, getHoverHandler(context))

    // Act
    const result = await client.sendRequest(HoverRequest.type, sentParams)

    // Assert
    const { value } = result?.contents as MarkupContent

    expect(value).toMatch('tolower')
    expect(value).toMatch(context.docs.functions['tolower(str)'])
  })

  it('should provide hint for builtin array members', async () => {
    // Arrange
    const sentParams: HoverParams = {
      textDocument: { uri: uriA },
      position: Position.create(9, 14),
    }

    server.onRequest(HoverRequest.type, getHoverHandler(context))

    // Act
    const result = await client.sendRequest(HoverRequest.type, sentParams)

    // Assert
    const { value } = result?.contents as MarkupContent

    expect(value).toMatch('PROCINFO["api_major"]')
    expect(value).toMatch(context.docs.builtins['PROCINFO["api_major"]'])
  })

  it('should provide hint for function defined in the same document', async () => {
    // Arrange
    const sentParams: HoverParams = {
      textDocument: { uri: uriA },
      position: Position.create(7, 10),
    }

    server.onRequest(HoverRequest.type, getHoverHandler(context))

    // Act
    const result = await client.sendRequest(HoverRequest.type, sentParams)

    // Assert
    const { value } = result?.contents as MarkupContent

    expect(value).toMatch('f(a)')
  })

  it('should provide hint for function defined in included document', async () => {
    // Arrange
    const sentParams: HoverParams = {
      textDocument: { uri: uriA },
      position: Position.create(7, 15),
    }

    server.onRequest(HoverRequest.type, getHoverHandler(context))

    // Act
    const result = await client.sendRequest(HoverRequest.type, sentParams)

    // Assert
    const { value } = result?.contents as MarkupContent

    expect(value).toMatch('sum(a, b)')
  })

  it('should provide hint with comments preceding the function', async () => {
    // Arrange
    const sentParams: HoverParams = {
      textDocument: { uri: uriA },
      position: Position.create(7, 15),
    }

    server.onRequest(HoverRequest.type, getHoverHandler(context))

    // Act
    const result = await client.sendRequest(HoverRequest.type, sentParams)

    // Assert
    const { value } = result?.contents as MarkupContent

    expect(value).toMatch('Sums two numbers')
  })

  it('should provide hint for variable defined in the same document', async () => {
    // Arrange
    const sentParams: HoverParams = {
      textDocument: { uri: uriA },
      position: Position.create(8, 10),
    }

    server.onRequest(HoverRequest.type, getHoverHandler(context))

    // Act
    const result = await client.sendRequest(HoverRequest.type, sentParams)

    // Assert
    const { value } = result?.contents as MarkupContent

    expect(value).toMatch('str = tolower("Hello")')
  })

  it('should provide hint for variable defined in included document', async () => {
    // Arrange
    const sentParams: HoverParams = {
      textDocument: { uri: uriA },
      position: Position.create(8, 15),
    }

    server.onRequest(HoverRequest.type, getHoverHandler(context))

    // Act
    const result = await client.sendRequest(HoverRequest.type, sentParams)

    // Assert
    const { value } = result?.contents as MarkupContent

    expect(value).toMatch('var_b = 42')
  })

  it('should provide hint for function in indirectly included document', async () => {
    // Arrange
    const sentParams: HoverParams = {
      textDocument: { uri: uriC },
      position: Position.create(0, 2),
    }

    server.onRequest(HoverRequest.type, getHoverHandler(context))

    // Act
    const result = await client.sendRequest(HoverRequest.type, sentParams)

    // Assert
    const { value } = result?.contents as MarkupContent

    expect(value).toMatch('sum(a, b)')
  })

  it('should provide hint for namespaced symbol defined in the same document', async () => {
    // Arrange
    const sentParams: HoverParams = {
      textDocument: { uri: uriA },
      position: Position.create(16, 13),
    }

    server.onRequest(HoverRequest.type, getHoverHandler(context))

    // Act
    const result = await client.sendRequest(HoverRequest.type, sentParams)

    // Assert
    const { value } = result?.contents as MarkupContent

    expect(value).toMatch('x = "a"')
  })

  it('should provide hint for namespaced symbol defined in included document', async () => {
    // Arrange
    const sentParams: HoverParams = {
      textDocument: { uri: uriA },
      position: Position.create(17, 13),
    }

    server.onRequest(HoverRequest.type, getHoverHandler(context))

    // Act
    const result = await client.sendRequest(HoverRequest.type, sentParams)

    // Assert
    const { value } = result?.contents as MarkupContent

    expect(value).toMatch('x = "b"')
  })

  it('should provide hint for namespaced function defined in the same document', async () => {
    // Arrange
    const sentParams: HoverParams = {
      textDocument: { uri: uriA },
      position: Position.create(23, 7),
    }

    server.onRequest(HoverRequest.type, getHoverHandler(context))

    // Act
    const result = await client.sendRequest(HoverRequest.type, sentParams)

    // Assert
    const { value } = result?.contents as MarkupContent

    expect(value).toMatch('fn(a)')
  })

  it('should provide hint for namespaced function defined in included document', async () => {
    // Arrange
    const sentParams: HoverParams = {
      textDocument: { uri: uriA },
      position: Position.create(24, 7),
    }

    server.onRequest(HoverRequest.type, getHoverHandler(context))

    // Act
    const result = await client.sendRequest(HoverRequest.type, sentParams)

    // Assert
    const { value } = result?.contents as MarkupContent

    expect(value).toMatch('fn(b)')
  })
})
