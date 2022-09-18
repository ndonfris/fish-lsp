import {
  CancellationToken,
  DocumentSemanticTokensProvider,
  SemanticTokens,
  SemanticTokensBuilder,
  TextDocument,
} from 'vscode'
import { LanguageClient } from 'vscode-languageclient/node'

const tokenTypes = new Map<string, number>()

export const tokenTypesLegend = [
  'comment',
  'function',
  'keyword',
  'number',
  'operator',
  'regexp',
  'string',
  'variable',
  'namespace',
]

tokenTypesLegend.forEach((tokenType, index) => tokenTypes.set(tokenType, index))

interface UnencodedSemanticToken {
  line: number
  startChar: number
  length: number
  tokenType: string
  tokenModifiers: string[]
}

export class SemanticTokensProvider implements DocumentSemanticTokensProvider {
  private client: LanguageClient

  public constructor(client: LanguageClient) {
    this.client = client
  }

  async provideDocumentSemanticTokens(
    textDocument: TextDocument,
    token: CancellationToken,
  ): Promise<SemanticTokens> {
    const parsedTokens: UnencodedSemanticToken[] = await this.client.sendRequest(
      'getSemanticTokens',
      {
        // uri is of different type for TextDocument in vscode and on server
        textDocument: { ...textDocument, uri: textDocument.uri.toString() },
      },
    )

    const builder = new SemanticTokensBuilder()

    for (const token of parsedTokens) {
      builder.push(
        token.line,
        token.startChar,
        token.length,
        tokenTypes.get(token.tokenType) || 0,
        0,
      )
    }

    return builder.build()
  }
}
