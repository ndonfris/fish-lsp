
import { LspDocument } from '../document';
import { execFishNoExecute } from '../utils/exec';
import { uriToPath } from '../utils/translation';
import { Diagnostic, DiagnosticSeverity } from 'vscode-languageserver';
import { FishDiagnostic } from './validate';
import { config } from '../config';

/**
 * only exported for testing purposes,
 * use getFishNoExecDiagnostics()
 */
export function fishNoExecuteDiagnostic(doc: LspDocument) {
  const path = uriToPath(doc.uri);
  const result = execFishNoExecute(path);
  return result;
}

// Regex pattern for fish errors: filename (line N): message
const FISH_ERROR_PATTERN = /^(?:.*?fish: )?(.+) \(line (\d+)\): (.+)$/gm;

interface FishError {
  fileName: string;
  lineNumber: number;
  message: string;
}

/**
 * Parse fish shell error output into structured FishError objects
 */
function parseFishErrors(output: string): FishError[] {
  const errors: FishError[] = [];
  let match: RegExpExecArray | null;

  while ((match = FISH_ERROR_PATTERN.exec(output)) !== null) {
    errors.push({
      fileName: match[1] as string,
      lineNumber: parseInt(match[2] as string, 10),
      message: match[3] as string,
    });
  }

  return errors;
}

/**
 * Check if a diagnostic already exists at the given line
 */
function hasDiagnosticAtLine(existingDiagnostics: Diagnostic[], lineNumber: number): boolean {
  return existingDiagnostics.some(diagnostic =>
    diagnostic.range.start.line === lineNumber && diagnostic.range.end.line === lineNumber,
  );
}

/**
 * Convert fish --no-execute output into LSP Diagnostics
 */
export function getFishNoExecDiagnostics(
  document: LspDocument,
  existingDiagnostics: Diagnostic[] = [],
) {
  if (config.fish_lsp_diagnostic_disable_error_codes.includes(9999)) return;
  const output = fishNoExecuteDiagnostic(document);
  const errors = parseFishErrors(output);

  for (const error of errors) {
    const lineNumber = error.lineNumber - 1;

    // Skip if we already have a diagnostic on this line
    if (hasDiagnosticAtLine(existingDiagnostics, lineNumber)) {
      continue;
    }

    // Create range for the full line
    const range = document.getLineRange(lineNumber);

    const diagnostic: Diagnostic = {
      severity: DiagnosticSeverity.Error,
      range,
      message: error.message,
      source: 'fish-lsp',
      code: 9999,
    };

    existingDiagnostics.push(FishDiagnostic.fromDiagnostic(diagnostic) as Diagnostic);
  }
}
