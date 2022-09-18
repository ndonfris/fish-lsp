import { readFileSync } from 'fs'
import { join } from 'path'
import {
  Diagnostic,
  DiagnosticSeverity,
  MessageConnection,
} from 'vscode-languageserver-protocol'
import { getConnections, getDummyContext, getRange } from '../helpers'
import { TextDocumentChangeEvent } from 'vscode-languageserver/node'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { getDidChangeContentHandler } from '../../src/handlers/handleDidChangeContent'
import { initializeParser } from '../../src/parser'
import * as Parser from 'web-tree-sitter'
import { Context } from '../../src/interfaces'

describe('handleDidChangeContent', () => {
  let server: MessageConnection
  let parser: Parser
  let context: Context
  let fileContent: string
  let uri: string
  let change: TextDocumentChangeEvent<TextDocument>

  beforeAll(async () => {
    const connections = getConnections()

    server = connections.server
    parser = await initializeParser()
    fileContent = readFileSync(
      join('server', 'tests', 'handlers', 'fixtures', 'did_change.awk'),
      'utf8',
    )
    uri = 'file:///my_file.awk'
    change = {
      document: TextDocument.create(uri, 'awk', 0, fileContent),
    }
  })

  beforeEach(() => {
    context = getDummyContext(server, parser)
  })

  it('should send diagnostics to client', async () => {
    // Arrange
    const handleDidChangeContent = getDidChangeContentHandler(context)

    // Act
    handleDidChangeContent(change)

    // Assert
    expect(context.connection.sendDiagnostics).toBeCalledWith({
      uri,
      diagnostics: [
        Diagnostic.create(
          getRange(0, 0, 0, 22),
          'File does not exist',
          DiagnosticSeverity.Error,
        ),
        Diagnostic.create(getRange(5, 4, 5, 7), 'Syntax error', DiagnosticSeverity.Error),
      ],
    })
  })

  it('should update trees', async () => {
    // Arrange
    const handleDidChangeContent = getDidChangeContentHandler(context)

    // Act
    handleDidChangeContent(change)

    // Assert
    expect(context.trees[uri]).toHaveProperty('rootNode')
  })

  it('should update symbols', async () => {
    // Arrange
    const handleDidChangeContent = getDidChangeContentHandler(context)

    // Act
    handleDidChangeContent(change)

    // Assert
    expect(context.symbols[uri].has('my_func')).toBeTruthy()
  })

  it('should update dependencies', async () => {
    // Arrange
    const handleDidChangeContent = getDidChangeContentHandler(context)

    // Act
    handleDidChangeContent(change)

    // Assert
    expect(context.dependencies.has(uri)).toBeTruthy()
    expect(context.dependencies.has('file:///somelib.awk')).toBeTruthy()
  })
})
