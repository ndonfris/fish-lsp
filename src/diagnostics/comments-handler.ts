import { SyntaxNode } from 'web-tree-sitter';
import { isComment } from '../utils/node-types';
import { ErrorCodes } from './errorCodes';
import { config } from '../config';

export type DiagnosticAction = 'enable' | 'disable';
export type DiagnosticTarget = 'line' | 'next-line';

export interface DiagnosticComment {
  action: DiagnosticAction;
  target: DiagnosticTarget;
  codes: ErrorCodes.codeTypes[];
  lineNumber: number;
  invalidCodes?: string[]; // Track any invalid codes found during parsing
}

/**
 * Regular expression to match fish-lsp diagnostic control comments
 * Matches patterns like:
 * # @fish-lsp-disable
 * # @fish-lsp-enable
 * # @fish-lsp-disable 1001 1002
 * # @fish-lsp-enable 1001
 * # @fish-lsp-disable-next-line
 * # @fish-lsp-disable-next-line 3002 3001
 */
export const DIAGNOSTIC_COMMENT_REGEX = /^#\s*@fish-lsp-(disable|enable)(?:-(next-line))?\s*([0-9\s]*)?$/;

/**
 * Checks if a node is a diagnostic control comment
 * @param node The syntax node to check
 * @returns true if the node is a diagnostic control comment
 */
export function isDiagnosticComment(node: SyntaxNode): boolean {
  if (!isComment(node)) return false;
  return DIAGNOSTIC_COMMENT_REGEX.test(node.text.trim());
}

export function isValidErrorCode(code: number): code is ErrorCodes.codeTypes {
  return Object.values(ErrorCodes).includes(code as ErrorCodes.codeTypes);
}

/**
 * Parses a diagnostic comment node into its components
 * @param node The syntax node to parse
 * @returns DiagnosticComment object containing the parsed information
 */
export function parseDiagnosticComment(node: SyntaxNode): DiagnosticComment | null {
  if (!isDiagnosticComment(node)) return null;

  const match = node.text.trim().match(DIAGNOSTIC_COMMENT_REGEX);
  if (!match) return null;

  const [, action, nextLine, codesStr] = match;

  const codeStrings = codesStr ? codesStr.trim().split(/\s+/) : [];

  // Parse the diagnostic codes if present
  const parsedCodes = codeStrings
    .map(codeStr => parseInt(codeStr, 10))
    .filter(code => !isNaN(code));

  const validCodes: ErrorCodes.codeTypes[] = [];
  const invalidCodes: string[] = [];

  codeStrings.forEach((codeStr, idx) => {
    const code = parsedCodes[idx];
    if (code && !isNaN(code) && isValidErrorCode(code)) {
      validCodes.push(code);
    } else {
      invalidCodes.push(codeStr);
    }
  });

  return {
    action: action as DiagnosticAction,
    target: nextLine ? 'next-line' : 'line',
    codes: validCodes,
    lineNumber: node.startPosition.row,
    invalidCodes:  invalidCodes.length > 0 ? invalidCodes : undefined,
  };
}

function globalEnabledComments() {
  const allComments = ErrorCodes.allErrorCodes;
  if (config.fish_lsp_diagnostic_disable_error_codes.length > 0) {
    return allComments.filter((comment) => !config.fish_lsp_diagnostic_disable_error_codes.includes(comment));
  }
  return allComments;
}

export interface DiagnosticState {
  enabledCodes: Set<ErrorCodes.codeTypes>;
  comment: DiagnosticComment;
  invalidCodes?: string[];
}

export class DiagnosticCommentsHandler {
  private stateStack: DiagnosticState[] = [];
  public enabledComments: ErrorCodes.codeTypes[] = globalEnabledComments();
  public invalidCodeWarnings: Map<number, string[]> = new Map(); // lineNumber -> invalid codesublic invalidCodes: number[] = [];

  constructor() {
    // Initialize with global state
    this.pushState(this.initialState);
  }

  private get initialState(): DiagnosticState {
    return {
      enabledCodes: new Set(this.enabledComments),
      comment: {
        action: 'enable',
        target: 'line',
        codes: this.enabledComments,
        lineNumber: -1,
      },
    };
  }

  private get currentState(): DiagnosticState {
    return this.stateStack[this.stateStack.length - 1]!;
  }

  private pushState(state: DiagnosticState) {
    this.stateStack.push(state);
  }

  private popState() {
    if (this.stateStack.length > 1) { // Keep at least the global state
      this.stateStack.pop();
      this.enabledComments = Array.from(this.currentState.enabledCodes);
    }
  }

  public handleNode(node: SyntaxNode): void {
    // Clean up any expired next-line comments
    this.cleanupNextLineComments(node.startPosition.row);

    // Early return if not a diagnostic comment
    if (!isDiagnosticComment(node)) {
      return;
    }

    const comment = parseDiagnosticComment(node);
    if (!comment) return;

    // Track invalid codes if present
    if (comment.invalidCodes && comment.invalidCodes.length > 0) {
      this.invalidCodeWarnings.set(comment.lineNumber, comment.invalidCodes);
    }

    this.processComment(comment);
  }

  private processComment(comment: DiagnosticComment) {
    const newEnabledCodes = new Set(this.currentState.enabledCodes);

    if (['enable', 'disable'].includes(comment.action) && comment.codes.length === 0) {
      comment.codes = globalEnabledComments();
    }

    if (comment.action === 'disable') {
      comment.codes.forEach(code => newEnabledCodes.delete(code));
    } else {
      comment.codes.forEach(code => newEnabledCodes.add(code));
    }

    const newState: DiagnosticState = {
      enabledCodes: newEnabledCodes,
      comment,
      invalidCodes: comment.invalidCodes,

    };

    if (comment.target === 'next-line') {
      // For next-line, we'll push a new state that will be popped after the line
      this.pushState(newState);
    } else {
      // For regular comments, we'll replace the current state
      if (this.stateStack.length > 1) {
        this.popState(); // Remove the current state
      }
      this.pushState(newState);
    }

    this.enabledComments = Array.from(newEnabledCodes);
  }

  private cleanupNextLineComments(currentLine: number) {
    while (
      this.stateStack.length > 1 && // Keep global state
      this.currentState.comment.target === 'next-line' &&
      currentLine > this.currentState.comment.lineNumber + 1
    ) {
      this.popState();
    }
  }

  public isCodeEnabled(code: ErrorCodes.codeTypes): boolean {
    // ErrorCodes.allErrorCodes.filter(e => !this.currentState.enabledCodes.has(e))
    return !!this.enabledComments.find(comment => comment === code);
  }

  // For debugging/testing
  public getStackDepth(): number {
    return this.stateStack.length;
  }

  public getCurrentState(): DiagnosticState {
    return this.currentState;
  }

  public getCurrentStateVerbose() {
    const currentState = this.getCurrentState();
    const disabledCodes = ErrorCodes.allErrorCodes.filter(e => !currentState.enabledCodes.has(e));
    const enabledCodes = Array.from(currentState.enabledCodes)
      .map(e => ErrorCodes.codes[e].code)
      .concat(disabledCodes)
      .sort((a, b) => a - b)
      .map(item => {
        if (disabledCodes.includes(item)) return '....';
        return item;
      })
      .join(' | ');
    const invalidCodes = Array.from(this.invalidCodeWarnings.entries())
      .map(([line, codes]) => `${line}: ${codes.join(' | ')}`);
    return {
      depth: this.getStackDepth(),
      enabledCodes: enabledCodes,
      invalidCodes: invalidCodes,
      currentState: {
        action: currentState.comment.action,
        target: currentState.comment.target,
        codes: currentState.comment?.codes.join(' | '),
        lineNumber: currentState.comment.lineNumber,
      },
    };
  }
}
