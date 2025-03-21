import { Diagnostic, DiagnosticSeverity } from 'vscode-languageserver';
import { SyntaxNode } from 'web-tree-sitter';
import { ErrorCodes } from './error-codes';
import { isComment } from '../utils/node-types';
import { logger } from '../logger';

// More precise regex to capture exact positions of code numbers
const DIAGNOSTIC_COMMENT_REGEX = /^#\s*@fish-lsp-(disable|enable)(?:-(next-line))?\s/;

export function isPossibleDiagnosticComment(node: SyntaxNode): boolean {
  if (!isComment(node)) return false;
  return DIAGNOSTIC_COMMENT_REGEX.test(node.text.trim());
}

// Function to find codes with their positions
function findCodes(text: string): {code: string; startIndex: number;}[] {
  // Find where the codes section starts (after the directive)
  const directiveMatch = text.match(/@fish-lsp-(?:disable|enable)(?:-next-line)?/); // remove leading comment
  if (!directiveMatch) return [];

  const codesStart = directiveMatch.index! + directiveMatch[0].length;
  const codesSection = text.slice(codesStart);

  // Find all code tokens in the codes section
  const result: {code: string; startIndex: number;}[] = [];
  const codeRegex = /(\d+)/g;
  let match;

  while ((match = codeRegex.exec(codesSection)) !== null) {
    result.push({
      code: match[0],
      startIndex: codesStart + match.index,
    });
  }

  logger.log('Found codes:', result, 'on text:', text);
  logger.log('Directive:', directiveMatch);
  return result;
}

export function detectInvalidDiagnosticCodes(node: SyntaxNode): Diagnostic[] {
  // Early return if not a diagnostic comment
  if (!isComment(node)) return [];

  const text = node.text.trim();
  if (!DIAGNOSTIC_COMMENT_REGEX.test(text)) return [];

  // Find all code numbers with their positions
  const codePositions = findCodes(text);
  const diagnostics: Diagnostic[] = [];

  for (const { code, startIndex } of codePositions) {
    const codeNum = parseInt(code, 10) as ErrorCodes.CodeTypes;

    // Check if it's a valid error code
    if (isNaN(codeNum) || !ErrorCodes.allErrorCodes.includes(codeNum)) {
      // Create diagnostic for this invalid code
      diagnostics.push({
        severity: DiagnosticSeverity.Warning,
        range: {
          start: {
            line: node.startPosition.row,
            character: node.startPosition.column + startIndex,
          },
          end: {
            line: node.startPosition.row,
            character: node.startPosition.column + startIndex + code.length,
          },
        },
        message: `Invalid diagnostic code: '${code}'. Valid codes are: ${ErrorCodes.allErrorCodes.join(', ')}.`,
        source: 'fish-lsp',
        code: 'invalidDiagnosticCode',
        data: {
          node,
          invalidCode: code,
        },
      });
    }
  }

  return diagnostics;
}

// Function to add to the validate.ts getDiagnostics function
export function checkForInvalidDiagnosticCodes(node: SyntaxNode): Diagnostic[] {
  if (isPossibleDiagnosticComment(node)) {
    return detectInvalidDiagnosticCodes(node);
  }
  return [];
}
