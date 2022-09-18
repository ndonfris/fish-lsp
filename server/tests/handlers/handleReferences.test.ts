import {
  MessageConnection,
  Position,
  Location,
  ReferenceParams,
  ReferencesRequest,
} from 'vscode-languageserver-protocol'
import { getConnections, getDummyContext, getRange } from '../helpers'
import { Context } from '../../src/interfaces'
import { getReferencesHandler } from '../../src/handlers/handleReferences'
import { initializeParser } from '../../src/parser'
import { readFileSync } from 'fs'
import { join } from 'path'

describe('handleReferences', () => {
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

    const { trees, namespaces, dependencies } = context

    const contentA = readFileSync(
      join('server', 'tests', 'handlers', 'fixtures', 'references_a.awk'),
      'utf8',
    )
    const contentB = readFileSync(
      join('server', 'tests', 'handlers', 'fixtures', 'references_b.awk'),
      'utf8',
    )
    const contentC = readFileSync(
      join('server', 'tests', 'handlers', 'fixtures', 'references_c.awk'),
      'utf8',
    )

    uriA = 'file:///a.awk'
    uriB = 'file:///b.awk'
    uriC = 'file:///c.awk'

    trees[uriA] = parser.parse(contentA)
    trees[uriB] = parser.parse(contentB)
    trees[uriC] = parser.parse(contentC)

    namespaces[uriA].set('A', getRange(7, 0, 15, 0))
    namespaces[uriB].set('B', getRange(3, 0, 8, 0))

    dependencies.update(uriA, new Set([uriB]))
    dependencies.update(uriC, new Set([uriB]))
  })

  it('should provide referenced locations for same file symbols', async () => {
    // Arrange
    const sentParams: ReferenceParams = {
      context: { includeDeclaration: true },
      textDocument: { uri: uriA },
      position: Position.create(4, 2),
    }

    server.onRequest(ReferencesRequest.type, getReferencesHandler(context))

    // Act
    const result = await client.sendRequest(ReferencesRequest.type, sentParams)

    // Assert
    expect(result).toContainEqual(Location.create(uriA, getRange(2, 9, 2, 10)))
    expect(result).toContainEqual(Location.create(uriA, getRange(4, 2, 4, 3)))
  })

  it('should provide referenced locations for symbols in included documents', async () => {
    // Arrange
    const sentParams: ReferenceParams = {
      context: { includeDeclaration: true },
      textDocument: { uri: uriA },
      position: Position.create(4, 8),
    }

    server.onRequest(ReferencesRequest.type, getReferencesHandler(context))

    // Act
    const result = await client.sendRequest(ReferencesRequest.type, sentParams)

    // Assert
    expect(result).toContainEqual(Location.create(uriA, getRange(4, 8, 4, 11)))
    expect(result).toContainEqual(Location.create(uriB, getRange(0, 9, 0, 12)))
  })

  it('should provide referenced locations for symbols in parent documents', async () => {
    // Arrange
    const sentParams: ReferenceParams = {
      context: { includeDeclaration: true },
      textDocument: { uri: uriB },
      position: Position.create(0, 9),
    }

    server.onRequest(ReferencesRequest.type, getReferencesHandler(context))

    // Act
    const result = await client.sendRequest(ReferencesRequest.type, sentParams)

    // Assert
    expect(result).toContainEqual(Location.create(uriA, getRange(4, 8, 4, 11)))
    expect(result).toContainEqual(Location.create(uriB, getRange(0, 9, 0, 12)))
  })

  it('should provide referenced locations for symbols function parameters', async () => {
    // Arrange
    const sentParams: ReferenceParams = {
      context: { includeDeclaration: true },
      textDocument: { uri: uriA },
      position: Position.create(2, 16),
    }

    server.onRequest(ReferencesRequest.type, getReferencesHandler(context))

    // Act
    const result = await client.sendRequest(ReferencesRequest.type, sentParams)

    // Assert
    expect(result).toHaveLength(2)
    expect(result).toContainEqual(Location.create(uriA, getRange(2, 11, 2, 12)))
    expect(result).toContainEqual(Location.create(uriA, getRange(2, 16, 2, 17)))
    expect(result).not.toContainEqual(Location.create(uriA, getRange(4, 19, 4, 20)))
  })

  it('should provide referenced locations in document which are linked via included documents', async () => {
    // Arrange
    const sentParams: ReferenceParams = {
      context: { includeDeclaration: true },
      textDocument: { uri: uriA },
      position: Position.create(4, 8),
    }

    server.onRequest(ReferencesRequest.type, getReferencesHandler(context))

    // Act
    const result = await client.sendRequest(ReferencesRequest.type, sentParams)

    // Assert
    expect(result).toHaveLength(3)
    expect(result).toContainEqual(Location.create(uriA, getRange(4, 8, 4, 11)))
    expect(result).toContainEqual(Location.create(uriB, getRange(0, 9, 0, 12)))
    expect(result).toContainEqual(Location.create(uriC, getRange(2, 2, 2, 5)))
  })

  it('should provide referenced locations for namespaced symbol from the same file', async () => {
    // Arrange
    const sentParams: ReferenceParams = {
      context: { includeDeclaration: true },
      textDocument: { uri: uriA },
      position: Position.create(11, 13),
    }

    server.onRequest(ReferencesRequest.type, getReferencesHandler(context))

    // Act
    const result = await client.sendRequest(ReferencesRequest.type, sentParams)

    // Assert
    expect(result).toEqual([
      Location.create(uriA, getRange(8, 9, 8, 11)),
      Location.create(uriA, getRange(11, 13, 11, 15)),
    ])
  })

  it('should provide referenced locations for namespaced symbol from included file', async () => {
    // Arrange
    const sentParams: ReferenceParams = {
      context: { includeDeclaration: true },
      textDocument: { uri: uriB },
      position: Position.create(6, 8),
    }

    server.onRequest(ReferencesRequest.type, getReferencesHandler(context))

    // Act
    const result = await client.sendRequest(ReferencesRequest.type, sentParams)

    // Assert
    expect(result).toEqual([
      Location.create(uriB, getRange(4, 9, 4, 11)),
      Location.create(uriB, getRange(6, 8, 6, 10)),
      Location.create(uriA, getRange(12, 13, 12, 15)),
    ])
  })
})
