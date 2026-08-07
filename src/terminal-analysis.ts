import * as path from 'path';
import { Connection, Diagnostic, Position } from 'vscode-languageserver';
import { analyzer } from './analyze';
import { LspDocument } from './document';
import { getDiagnosticsAsync } from './diagnostics/validate';
import { pathToUri } from './utils/translation';

/**
 * Custom request used by shell integrations to analyze the current interactive
 * fish command line without opening a normal editor TextDocument.
 */
export const TERMINAL_ANALYZE_REQUEST = 'fish-lsp/terminal/analyze';

export interface TerminalAnalyzeParams {
  /** Current editable fish command line. May contain multiple lines. */
  text: string;
  /** Cursor offset in UTF-16 code units, matching TextDocument offsets. */
  cursor: number;
  /** Current working directory of the interactive shell. */
  cwd: string;
  /** Stable terminal identifier supplied by a client, when available. */
  terminalId?: string;
}

export interface TerminalAnalyzeResult {
  /** URI used internally for the ephemeral terminal document. */
  uri: string;
  /** Cursor position translated to an LSP Position. */
  position: Position;
  /** Diagnostics computed by the normal fish-lsp diagnostic pipeline. */
  diagnostics: Diagnostic[];
}

function safeTerminalId(id: string | undefined): string {
  if (!id) return 'active';
  return id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || 'active';
}

/**
 * Use a file URI rooted in the terminal cwd rather than a custom URI scheme.
 * A number of existing analyzer/diagnostic paths intentionally resolve a
 * document URI back to a filesystem path; using the cwd keeps those operations
 * meaningful while the file itself remains purely virtual.
 */
export function createTerminalDocument(params: TerminalAnalyzeParams): LspDocument {
  const terminalPath = path.join(
    path.resolve(params.cwd),
    `.fish-lsp-terminal-${safeTerminalId(params.terminalId)}.fish`,
  );

  return LspDocument.createTextDocumentItem(pathToUri(terminalPath), params.text);
}

export async function analyzeTerminalBuffer(
  params: TerminalAnalyzeParams,
): Promise<TerminalAnalyzeResult> {
  const document = createTerminalDocument(params);
  const analyzed = analyzer.analyze(document);
  const root = analyzed.root;

  const cursor = Math.max(0, Math.min(params.cursor, params.text.length));
  const position = document.positionAt(cursor);

  if (!root) {
    return {
      uri: document.uri,
      position,
      diagnostics: [],
    };
  }

  const diagnostics = await getDiagnosticsAsync(root, document);

  return {
    uri: document.uri,
    position,
    diagnostics,
  };
}

/** Register the terminal MVP request on an existing fish-lsp connection. */
export function registerTerminalAnalysisRequest(connection: Connection): void {
  connection.onRequest(
    TERMINAL_ANALYZE_REQUEST,
    (params: TerminalAnalyzeParams) => analyzeTerminalBuffer(params),
  );
}
