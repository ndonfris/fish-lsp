// import { spawnSync } from 'child_process';
import { LspDocument } from '../document';
import { Diagnostic, DiagnosticSeverity } from 'vscode-languageserver';
import { logger } from '../logger';
import { execFishNoExecute } from '../utils/exec';
import { ErrorCodes } from './errorCodes';

/**
 * A unique diagnostic code to identify issues found by the no-execute diagnostic
 */
const NoExecuteErrorCode = ErrorCodes.syntaxError;

/**
 * Parse the output from `fish --no-execute` on a script to identify syntax errors
 * @param document The document to run the no-execute check on
 * @param testMode If true, returns detailed output for testing purposes
 * @returns Array of diagnostics or detailed output if in test mode
 */
export function runNoExecuteDiagnostic(document: LspDocument): Diagnostic[] {
  try {
    // Get document content
    const scriptContent = document.getText();

    // Skip empty documents
    if (!scriptContent.trim()) {
      return [];
    }

    const result = execFishNoExecute(document.getFilePath()!);

    // Process the output and error
    if (result) {
      logger.log(`Fish --no-execute found output: ${result}`);
      return fishOutputToDiagnostics(result, document);
      // return parseNoExecuteOutput(result, document);
    }

    return [];
  } catch (error) {
    // Log the error but don't throw it
    logger.log(`Error in no-execute diagnostic: ${error}`);
    return [];
  }
}

/**
 * The main function to be called from validate.ts
 */
export function getNoExecuteDiagnostics(document: LspDocument): Diagnostic[] {
  // Only run on .fish files
  if (!document.uri.endsWith('.fish')) {
    return [];
  }

  const diagnostics = runNoExecuteDiagnostic(document);
  logger.log(`No-execute diagnostics for ${document.uri}: ${diagnostics.length} issues found`);
  return diagnostics;
}

/**
 * Parse fish errors from Fish output for a given document.
 *
 * @param document The document to whose contents errors refer
 * @param output The error output from Fish.
 * @return An array of all diagnostics
 */
const fishOutputToDiagnostics = (
  output: string,
  document: LspDocument,
): Diagnostic[] => {
  const diagnostics: Array<Diagnostic> = [];
  const matches = getMatches(/^(.+) \(line (\d+)\): (.+)$/gm, output);
  for (const match of matches) {
    const lineNumber = Number.parseInt(match[2]!);
    const message = match[3];

    const range = document.getLineRange(lineNumber - 1);
    const diagnostic = {
      severity: DiagnosticSeverity.Error,
      range,
      message: `Fish syntax error: ${message}`,
      source: 'fish-lsp',
      code: NoExecuteErrorCode,
      data: { isNoExecute: true, output },
    };
    diagnostics.push(diagnostic);
  }
  return diagnostics;
};

/**
 * Exec pattern against the given text and return an array of all matches.
 *
 * @param pattern The pattern to match against
 * @param text The text to match the pattern against
 * @return All matches of pattern in text.
 */
const getMatches = (
  pattern: RegExp,
  text: string,
): ReadonlyArray<RegExpExecArray> => {
  const results = [];
  // We need to loop through the regexp here, so a let is required
  let match = pattern.exec(text);
  while (match !== null) {
    results.push(match);
    match = pattern.exec(text);
  }
  return results;
};
