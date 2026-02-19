import { SyntaxNode } from 'web-tree-sitter';
import { ErrorCodes } from './error-codes';
import { config } from '../config';
import { isComment } from '../utils/node-types';
import { nodesGen } from '../utils/tree-sitter';

/**
 * Represents a range where a specific diagnostic code is disabled
 */
export interface DisabledRange {
  startLine: number;
  endLine: number; // -1 means until end of file
  code: ErrorCodes.CodeTypes; // Single code per range for clarity
}

/**
 * Result of pre-computing diagnostic ranges
 */
export interface DiagnosticRangesResult {
  /** Ranges where specific codes are disabled (one range per code) */
  disabledRanges: DisabledRange[];
  /** Lines with invalid diagnostic codes in comments (for reporting) */
  invalidCodeLines: Map<number, string[]>;
  /** Total number of diagnostic comments found */
  commentCount: number;
  /** Time taken to compute ranges (ms) */
  computeTimeMs: number;
}

/**
 * Regular expression to match fish-lsp diagnostic control comments
 */
const DIAGNOSTIC_COMMENT_REGEX = /^#\s*@fish-lsp-(disable|enable)(?:-(next-line))?\s*([0-9\s]*)?$/;

/**
 * Check if a code is a valid ErrorCode
 */
function isValidErrorCode(code: number): code is ErrorCodes.CodeTypes {
  return Object.values(ErrorCodes).includes(code as ErrorCodes.CodeTypes);
}

/**
 * Get the globally enabled codes based on config
 */
function getGlobalEnabledCodes(): Set<ErrorCodes.CodeTypes> {
  const codes = ErrorCodes.allErrorCodes.filter(code =>
    ErrorCodes.nonDeprecatedErrorCodes.some(e => e.code === code),
  );

  if (config.fish_lsp_diagnostic_disable_error_codes.length > 0) {
    return new Set(
      codes.filter(code => !config.fish_lsp_diagnostic_disable_error_codes.includes(code)),
    );
  }

  return new Set(codes);
}

interface ParsedComment {
  action: 'enable' | 'disable';
  isNextLine: boolean;
  codes: ErrorCodes.CodeTypes[];
  allCodes: boolean; // true if no specific codes were specified (applies to all)
  lineNumber: number;
  invalidCodes: string[];
}

/**
 * Parse a diagnostic comment from a syntax node
 */
function parseDiagnosticComment(node: SyntaxNode): ParsedComment | null {
  if (!isComment(node)) return null;

  const match = node.text.trim().match(DIAGNOSTIC_COMMENT_REGEX);
  if (!match) return null;

  const [, action, nextLine, codesStr] = match;

  const codeStrings = codesStr ? codesStr.trim().split(/\s+/).filter(s => s.length > 0) : [];

  const validCodes: ErrorCodes.CodeTypes[] = [];
  const invalidCodes: string[] = [];

  for (const codeStr of codeStrings) {
    const code = parseInt(codeStr, 10);
    if (!isNaN(code) && isValidErrorCode(code)) {
      validCodes.push(code);
    } else if (codeStr.length > 0) {
      invalidCodes.push(codeStr);
    }
  }

  // If no codes specified, it applies to ALL codes
  const allCodes = validCodes.length === 0;
  const codes = allCodes ? Array.from(getGlobalEnabledCodes()) : validCodes;

  return {
    action: action as 'enable' | 'disable',
    isNextLine: !!nextLine,
    codes,
    allCodes,
    lineNumber: node.startPosition.row,
    invalidCodes,
  };
}

/**
 * Pre-compute diagnostic disabled ranges from the syntax tree.
 *
 * Handles cascading/overlapping disables correctly:
 * - `# @fish-lsp-disable 1001` on line 10 disables 1001 from line 10 onwards
 * - `# @fish-lsp-disable 1002` on line 20 ALSO disables 1002, but 1001 stays disabled
 * - `# @fish-lsp-enable` (no codes) re-enables ALL codes
 * - `# @fish-lsp-enable 1001` only re-enables 1001
 *
 * @param root - The root syntax node of the document
 * @param maxLine - The maximum line number in the document
 * @returns DiagnosticRangesResult with computed ranges
 */
export function computeDiagnosticRanges(root: SyntaxNode, maxLine: number): DiagnosticRangesResult {
  const startTime = performance.now();

  const disabledRanges: DisabledRange[] = [];
  const invalidCodeLines = new Map<number, string[]>();
  let commentCount = 0;

  // Track currently active disables PER CODE (cascading support)
  // Map: code -> startLine where it was disabled
  const activeDisables = new Map<ErrorCodes.CodeTypes, number>();

  // Collect all diagnostic comments first
  const comments: ParsedComment[] = [];

  for (const node of nodesGen(root)) {
    if (!isComment(node)) continue;

    const parsed = parseDiagnosticComment(node);
    if (parsed) {
      comments.push(parsed);
      commentCount++;

      if (parsed.invalidCodes.length > 0) {
        invalidCodeLines.set(parsed.lineNumber, parsed.invalidCodes);
      }
    }
  }

  // Sort comments by line number
  comments.sort((a, b) => a.lineNumber - b.lineNumber);

  // Process comments to build ranges
  for (const comment of comments) {
    if (comment.isNextLine) {
      // Next-line comments create single-line disabled ranges
      if (comment.action === 'disable') {
        for (const code of comment.codes) {
          disabledRanges.push({
            startLine: comment.lineNumber + 1,
            endLine: comment.lineNumber + 1,
            code,
          });
        }
      }
      // Note: enable-next-line is rare and would temporarily re-enable within a disabled block
      // For simplicity, we don't support this edge case
    } else {
      // Regular disable/enable comments
      if (comment.action === 'disable') {
        // Start tracking each code independently
        for (const code of comment.codes) {
          if (!activeDisables.has(code)) {
            // Only start a new range if not already disabled
            activeDisables.set(code, comment.lineNumber);
          }
          // If already disabled, the existing disable continues (no action needed)
        }
      } else {
        // Enable comment - close ranges for the specified codes
        for (const code of comment.codes) {
          const startLine = activeDisables.get(code);
          if (startLine !== undefined) {
            // Close the range for this code
            disabledRanges.push({
              startLine,
              endLine: comment.lineNumber - 1,
              code,
            });
            activeDisables.delete(code);
          }
        }
      }
    }
  }

  // Close any remaining active disables (extend to end of file)
  for (const [code, startLine] of activeDisables.entries()) {
    disabledRanges.push({
      startLine,
      endLine: maxLine,
      code,
    });
  }

  const computeTimeMs = performance.now() - startTime;

  return {
    disabledRanges,
    invalidCodeLines,
    commentCount,
    computeTimeMs,
  };
}

/**
 * Fast lookup class for checking if a diagnostic code is enabled at a specific line
 */
export class DiagnosticRangeChecker {
  private disabledRanges: DisabledRange[];
  private globalEnabledCodes: Set<ErrorCodes.CodeTypes>;

  // Optimized: Pre-compute a map of line -> disabled codes for fast lookup
  private lineDisabledCodes: Map<number, Set<ErrorCodes.CodeTypes>> = new Map();
  private maxPrecomputedLine: number = -1;

  constructor(ranges: DiagnosticRangesResult, maxLine?: number) {
    this.disabledRanges = ranges.disabledRanges;
    this.globalEnabledCodes = getGlobalEnabledCodes();

    // Pre-compute line lookup map if maxLine is provided
    if (maxLine !== undefined && maxLine <= 10000) {
      this.precomputeLineLookup(maxLine);
    }
  }

  /**
   * Pre-compute disabled codes for each line for O(1) lookup
   */
  private precomputeLineLookup(maxLine: number): void {
    for (let line = 0; line <= maxLine; line++) {
      const disabledCodes = new Set<ErrorCodes.CodeTypes>();

      for (const range of this.disabledRanges) {
        const endLine = range.endLine === -1 ? maxLine : range.endLine;
        if (line >= range.startLine && line <= endLine) {
          disabledCodes.add(range.code);
        }
      }

      if (disabledCodes.size > 0) {
        this.lineDisabledCodes.set(line, disabledCodes);
      }
    }

    this.maxPrecomputedLine = maxLine;
  }

  /**
   * Check if a specific diagnostic code is enabled at a given line
   * O(1) if pre-computed, O(ranges) otherwise
   */
  isCodeEnabledAtLine(code: ErrorCodes.CodeTypes, line: number): boolean {
    // Check if globally disabled first
    if (!this.globalEnabledCodes.has(code)) {
      return false;
    }

    // Use pre-computed lookup if available
    if (line <= this.maxPrecomputedLine) {
      const disabled = this.lineDisabledCodes.get(line);
      return !disabled || !disabled.has(code);
    }

    // Fall back to range checking
    for (const range of this.disabledRanges) {
      const endLine = range.endLine === -1 ? Infinity : range.endLine;
      if (line >= range.startLine && line <= endLine && range.code === code) {
        return false;
      }
    }

    return true;
  }

  /**
   * Check if a specific diagnostic code is enabled at a node's position
   */
  isCodeEnabledAtNode(code: ErrorCodes.CodeTypes, node: SyntaxNode): boolean {
    return this.isCodeEnabledAtLine(code, node.startPosition.row);
  }

  /**
   * Get all disabled codes at a specific line (for debugging)
   */
  getDisabledCodesAtLine(line: number): ErrorCodes.CodeTypes[] {
    if (line <= this.maxPrecomputedLine) {
      const codes = this.lineDisabledCodes.get(line);
      return codes ? Array.from(codes) : [];
    }

    const disabled: ErrorCodes.CodeTypes[] = [];
    for (const range of this.disabledRanges) {
      const endLine = range.endLine === -1 ? Infinity : range.endLine;
      if (line >= range.startLine && line <= endLine) {
        disabled.push(range.code);
      }
    }

    return [...new Set(disabled)];
  }

  /**
   * Get summary information about the computed ranges
   */
  getSummary(): {
    totalRanges: number;
    precomputedLines: number;
    linesWithDisabledCodes: number;
  } {
    return {
      totalRanges: this.disabledRanges.length,
      precomputedLines: this.maxPrecomputedLine + 1,
      linesWithDisabledCodes: this.lineDisabledCodes.size,
    };
  }

  /**
   * Debug: Get detailed state at a specific line
   */
  getLineState(line: number): {
    line: number;
    disabledCodes: ErrorCodes.CodeTypes[];
    enabledCodes: ErrorCodes.CodeTypes[];
  } {
    const disabledCodes = this.getDisabledCodesAtLine(line);
    const disabledSet = new Set(disabledCodes);
    const enabledCodes = Array.from(this.globalEnabledCodes).filter(c => !disabledSet.has(c));

    return {
      line,
      disabledCodes,
      enabledCodes,
    };
  }
}

/**
 * Convenience function to create a DiagnosticRangeChecker from a syntax tree
 */
export function createDiagnosticChecker(root: SyntaxNode, maxLine: number): {
  checker: DiagnosticRangeChecker;
  result: DiagnosticRangesResult;
} {
  const result = computeDiagnosticRanges(root, maxLine);
  const checker = new DiagnosticRangeChecker(result, maxLine);
  return { checker, result };
}
