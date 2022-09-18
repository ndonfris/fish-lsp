import {
  MessageConnection,
  Position,
  RenameParams,
  RenameRequest,
  TextEdit,
} from 'vscode-languageserver-protocol'
import { getConnections, getDummyContext, getRange } from '../helpers'
import { Context } from '../../src/interfaces'
import { getRenameRequestHandler } from '../../src/handlers/handleRenameRequest'
import { initializeParser } from '../../src/parser'
import { readFileSync } from 'fs'
import { join } from 'path'

describe('handleRenameRequest', () => {
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
      join('server', 'tests', 'handlers', 'fixtures', 'rename_a.awk'),
      'utf8',
    )
    const contentB = readFileSync(
      join('server', 'tests', 'handlers', 'fixtures', 'rename_b.awk'),
      'utf8',
    )
    const contentC = readFileSync(
      join('server', 'tests', 'handlers', 'fixtures', 'rename_c.awk'),
      'utf8',
    )

    uriA = 'file:///a.awk'
    uriB = 'file:///b.awk'
    uriC = 'file:///c.awk'

    trees[uriA] = parser.parse(contentA)
    trees[uriB] = parser.parse(contentB)
    trees[uriC] = parser.parse(contentC)

    namespaces[uriA].set('A', getRange(7, 0, 10, 0))

    dependencies.update(uriA, new Set([uriB]))
    dependencies.update(uriC, new Set([uriB]))
  })

  it('should rename symbols in the same document', async () => {
    // Arrange
    const newName = 'a2'
    const sentParams: RenameParams = {
      textDocument: { uri: uriA },
      position: Position.create(4, 16),
      newName,
    }

    server.onRequest(RenameRequest.type, getRenameRequestHandler(context))

    // Act
    const result = await client.sendRequest(RenameRequest.type, sentParams)

    // Assert
    expect(result?.changes?.[uriA]).toEqual([
      TextEdit.replace(getRange(2, 9, 2, 10), newName),
      TextEdit.replace(getRange(4, 16, 4, 17), newName),
    ])
  })

  it('should rename symbols in included document and ', async () => {
    // Arrange
    const newName = 'b2'
    const sentParams: RenameParams = {
      textDocument: { uri: uriA },
      position: Position.create(4, 29),
      newName,
    }

    server.onRequest(RenameRequest.type, getRenameRequestHandler(context))

    // Act
    const result = await client.sendRequest(RenameRequest.type, sentParams)

    // Assert
    expect(result?.changes?.[uriA]).toEqual([
      TextEdit.replace(getRange(4, 29, 4, 30), newName),
    ])
    expect(result?.changes?.[uriB]).toEqual([
      TextEdit.replace(getRange(0, 9, 0, 10), newName),
    ])
  })

  it('should rename symbols in document which includes document with symbol', async () => {
    // Arrange
    const newName = 'b2'
    const sentParams: RenameParams = {
      textDocument: { uri: uriB },
      position: Position.create(0, 9),
      newName,
    }

    server.onRequest(RenameRequest.type, getRenameRequestHandler(context))

    // Act
    const result = await client.sendRequest(RenameRequest.type, sentParams)

    // Assert
    expect(result?.changes?.[uriA]).toEqual([
      TextEdit.replace(getRange(4, 29, 4, 30), newName),
    ])
    expect(result?.changes?.[uriB]).toEqual([
      TextEdit.replace(getRange(0, 9, 0, 10), newName),
    ])
    expect(result?.changes?.[uriC]).toEqual([
      TextEdit.replace(getRange(3, 10, 3, 11), newName),
    ])
  })

  it('should rename symbols in document which depends on included document ', async () => {
    // Arrange
    const newName = 'b2'
    const sentParams: RenameParams = {
      textDocument: { uri: uriA },
      position: Position.create(4, 29),
      newName,
    }

    server.onRequest(RenameRequest.type, getRenameRequestHandler(context))

    // Act
    const result = await client.sendRequest(RenameRequest.type, sentParams)

    // Assert
    expect(result?.changes?.[uriA]).toEqual([
      TextEdit.replace(getRange(4, 29, 4, 30), newName),
    ])
    expect(result?.changes?.[uriB]).toEqual([
      TextEdit.replace(getRange(0, 9, 0, 10), newName),
    ])
    expect(result?.changes?.[uriC]).toEqual([
      TextEdit.replace(getRange(3, 10, 3, 11), newName),
    ])
  })

  it('should rename function parameters without renaming global vars with the same name', async () => {
    // Arrange
    const newName = 'var_a2'
    const sentParams: RenameParams = {
      textDocument: { uri: uriA },
      position: Position.create(2, 20),
      newName,
    }

    server.onRequest(RenameRequest.type, getRenameRequestHandler(context))

    // Act
    const result = await client.sendRequest(RenameRequest.type, sentParams)

    // Assert
    expect(result?.changes?.[uriA]).toEqual([
      TextEdit.replace(getRange(2, 11, 2, 16), newName),
      TextEdit.replace(getRange(2, 20, 2, 25), newName),
    ])
  })

  it('should rename variables across multiple interdependent documents', async () => {
    // Arrange
    const newName = 'var_b2'
    const sentParams: RenameParams = {
      textDocument: { uri: uriA },
      position: Position.create(4, 21),
      newName,
    }

    server.onRequest(RenameRequest.type, getRenameRequestHandler(context))

    // Act
    const result = await client.sendRequest(RenameRequest.type, sentParams)

    // Assert
    expect(result?.changes?.[uriA]).toEqual([
      TextEdit.replace(getRange(4, 21, 4, 26), newName),
    ])
    expect(result?.changes?.[uriB]).toEqual([
      TextEdit.replace(getRange(3, 4, 3, 9), newName),
    ])
    expect(result?.changes?.[uriC]).toEqual([
      TextEdit.replace(getRange(4, 4, 4, 9), newName),
    ])
  })

  it('should not rename symbol with the same name but different namespace', async () => {
    // Arrange
    const newName = 'aaa'
    const sentParams: RenameParams = {
      textDocument: { uri: uriA },
      position: Position.create(8, 9),
      newName,
    }

    server.onRequest(RenameRequest.type, getRenameRequestHandler(context))

    // Act
    const result = await client.sendRequest(RenameRequest.type, sentParams)

    // Assert
    expect(result?.changes?.[uriA]).toEqual([
      TextEdit.replace(getRange(8, 9, 8, 10), newName),
    ])
  })
})
