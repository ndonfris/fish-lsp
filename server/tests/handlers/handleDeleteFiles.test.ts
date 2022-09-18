import { URL } from 'url'
import { MessageConnection } from 'vscode-languageserver-protocol'
import * as Parser from 'web-tree-sitter'
import {
  getDidDeleteFilesHandler,
  handleWillDeleteFiles,
} from '../../src/handlers/handleDeleteFiles'
import { Context, NamespaceMap, SymbolsMap } from '../../src/interfaces'
import * as io from '../../src/io'
import { initializeParser } from '../../src/parser'
import { getConnections, getDummyContext } from '../helpers'
import * as v from '../../src/validation/validate'

describe('handleDidDeleteFiles', () => {
  let server: MessageConnection
  let client: MessageConnection
  let context: Context
  let parser: Parser

  const uriA = 'file:///a.awk'
  const uriFolder = 'file:///folder/'
  const uriF1 = uriFolder + 'f1.awk'
  const uriB = 'file:///b.awk'

  const validate = jest.spyOn(v, 'validate')

  beforeAll(async () => {
    jest.spyOn(io, 'isDir').mockImplementation((uri: string) => uri.endsWith('/'))
    jest
      .spyOn(io, 'getAwkFilesInDir')
      .mockImplementation((_uri: string) => [uriF1, uriB].map((f) => new URL(f)))

    parser = await initializeParser()

    const connections = getConnections()

    server = connections.server
    client = connections.client
  })

  beforeEach(() => {
    context = getDummyContext(server, parser)
    context.namespaces = {} // Helper Proxy doesn't work well in this case

    const { trees, symbols, namespaces, dependencies } = context

    trees[uriA] = {} as Parser.Tree
    trees[uriB] = {} as Parser.Tree
    trees[uriF1] = {} as Parser.Tree

    symbols[uriA] = {} as SymbolsMap
    symbols[uriB] = {} as SymbolsMap
    symbols[uriF1] = {} as SymbolsMap

    namespaces[uriA] = {} as NamespaceMap
    namespaces[uriB] = {} as NamespaceMap
    namespaces[uriF1] = {} as NamespaceMap

    dependencies.update(uriA, new Set([uriF1, uriB]))
  })

  describe('Individual files', () => {
    it('should clean up trees', async () => {
      // Arrange
      const handleDidDeleteFiles = getDidDeleteFilesHandler(context)

      const willDeleteNotification = new Promise<void>((resolve) => {
        server.onNotification('workspace/willDeleteFiles', (params) => {
          resolve()
          handleWillDeleteFiles(params)
        })
      })

      const didDeleteNotification = new Promise<void>((resolve) => {
        server.onNotification('workspace/didDeleteFiles', (params) => {
          resolve()
          handleDidDeleteFiles(params)
        })
      })

      // Act
      client.sendNotification('workspace/willDeleteFiles', {
        files: [{ uri: uriB }],
      })
      client.sendNotification('workspace/didDeleteFiles', {
        files: [{ uri: uriB }],
      })

      await Promise.all([willDeleteNotification, didDeleteNotification])

      // Assert
      expect(context.trees[uriB]).toBeUndefined()
    })

    it('should clean up symbols', async () => {
      // Arrange
      const handleDidDeleteFiles = getDidDeleteFilesHandler(context)

      const willDeleteNotification = new Promise<void>((resolve) => {
        server.onNotification('workspace/willDeleteFiles', (params) => {
          resolve()
          handleWillDeleteFiles(params)
        })
      })

      const didDeleteNotification = new Promise<void>((resolve) => {
        server.onNotification('workspace/didDeleteFiles', (params) => {
          resolve()
          handleDidDeleteFiles(params)
        })
      })

      // Act
      client.sendNotification('workspace/willDeleteFiles', {
        files: [{ uri: uriB }],
      })
      client.sendNotification('workspace/didDeleteFiles', {
        files: [{ uri: uriB }],
      })

      await Promise.all([willDeleteNotification, didDeleteNotification])

      // Assert
      expect(context.symbols[uriB]).toBeUndefined()
    })

    it('should clean up namespaces', async () => {
      // Arrange
      const handleDidDeleteFiles = getDidDeleteFilesHandler(context)

      const willDeleteNotification = new Promise<void>((resolve) => {
        server.onNotification('workspace/willDeleteFiles', (params) => {
          resolve()
          handleWillDeleteFiles(params)
        })
      })

      const didDeleteNotification = new Promise<void>((resolve) => {
        server.onNotification('workspace/didDeleteFiles', (params) => {
          resolve()
          handleDidDeleteFiles(params)
        })
      })

      // Act
      client.sendNotification('workspace/willDeleteFiles', {
        files: [{ uri: uriB }],
      })
      client.sendNotification('workspace/didDeleteFiles', {
        files: [{ uri: uriB }],
      })

      await Promise.all([willDeleteNotification, didDeleteNotification])

      // Assert
      expect(context.namespaces[uriB]).toBeUndefined()
    })

    it('should revalidate dependents', async () => {
      // Arrange
      const handleDidDeleteFiles = getDidDeleteFilesHandler(context)

      const willDeleteNotification = new Promise<void>((resolve) => {
        server.onNotification('workspace/willDeleteFiles', (params) => {
          resolve()
          handleWillDeleteFiles(params)
        })
      })

      const didDeleteNotification = new Promise<void>((resolve) => {
        server.onNotification('workspace/didDeleteFiles', (params) => {
          resolve()
          handleDidDeleteFiles(params)
        })
      })

      // Act
      client.sendNotification('workspace/willDeleteFiles', {
        files: [{ uri: uriB }],
      })
      client.sendNotification('workspace/didDeleteFiles', {
        files: [{ uri: uriB }],
      })

      await Promise.all([willDeleteNotification, didDeleteNotification])

      // Assert
      expect(validate).toHaveBeenLastCalledWith(
        context.trees[uriA],
        context.symbols,
        context.namespaces,
        context.dependencies,
        uriA,
        context.docs,
      )
    })
  })

  describe('Folders', () => {
    it('should clean up trees', async () => {
      // Arrange
      const handleDidDeleteFiles = getDidDeleteFilesHandler(context)

      const willDeleteNotification = new Promise<void>((resolve) => {
        server.onNotification('workspace/willDeleteFiles', (params) => {
          resolve()
          handleWillDeleteFiles(params)
        })
      })

      const didDeleteNotification = new Promise<void>((resolve) => {
        server.onNotification('workspace/didDeleteFiles', (params) => {
          resolve()
          handleDidDeleteFiles(params)
        })
      })

      // Act
      client.sendNotification('workspace/willDeleteFiles', {
        files: [{ uri: uriFolder }],
      })
      client.sendNotification('workspace/didDeleteFiles', {
        files: [{ uri: uriFolder }],
      })

      await Promise.all([willDeleteNotification, didDeleteNotification])

      // Assert
      expect(context.trees[uriF1]).toBeUndefined()
    })

    it('should clean up symbols', async () => {
      // Arrange
      const handleDidDeleteFiles = getDidDeleteFilesHandler(context)

      const willDeleteNotification = new Promise<void>((resolve) => {
        server.onNotification('workspace/willDeleteFiles', (params) => {
          resolve()
          handleWillDeleteFiles(params)
        })
      })

      const didDeleteNotification = new Promise<void>((resolve) => {
        server.onNotification('workspace/didDeleteFiles', (params) => {
          resolve()
          handleDidDeleteFiles(params)
        })
      })

      // Act
      client.sendNotification('workspace/willDeleteFiles', {
        files: [{ uri: uriFolder }],
      })
      client.sendNotification('workspace/didDeleteFiles', {
        files: [{ uri: uriFolder }],
      })

      await Promise.all([willDeleteNotification, didDeleteNotification])

      // Assert
      expect(context.symbols[uriF1]).toBeUndefined()
    })

    it('should revalidate dependents', async () => {
      // Arrange
      const handleDidDeleteFiles = getDidDeleteFilesHandler(context)

      const willDeleteNotification = new Promise<void>((resolve) => {
        server.onNotification('workspace/willDeleteFiles', (params) => {
          resolve()
          handleWillDeleteFiles(params)
        })
      })

      const didDeleteNotification = new Promise<void>((resolve) => {
        server.onNotification('workspace/didDeleteFiles', (params) => {
          resolve()
          handleDidDeleteFiles(params)
        })
      })

      // Act
      client.sendNotification('workspace/willDeleteFiles', {
        files: [{ uri: uriFolder }],
      })
      client.sendNotification('workspace/didDeleteFiles', {
        files: [{ uri: uriFolder }],
      })

      await Promise.all([willDeleteNotification, didDeleteNotification])

      // Assert
      expect(validate).toHaveBeenLastCalledWith(
        context.trees[uriA],
        context.symbols,
        context.namespaces,
        context.dependencies,
        uriA,
        context.docs,
      )
    })
  })
})
