import { SyntaxNode } from 'web-tree-sitter';
import { isComment } from '../utils/node-types';
import { ErrorCodes } from './error-codes';
import { config } from '../config';
import { Position } from 'vscode-languageserver';

export type DiagnosticAction = 'enable' | 'disable';
export type DiagnosticTarget = 'line' | 'next-line';

export interface DiagnosticComment {
  action: DiagnosticAction;
  target: DiagnosticTarget;
  codes: ErrorCodes.CodeTypes[];
  lineNumber: number;
  invalidCodes?: string[]; // Track any invalid codes found during parsing
}

export interface DiagnosticState {
  enabledCodes: Set<ErrorCodes.CodeTypes>;
  comment: DiagnosticComment;
  invalidCodes?: string[];
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

export function isValidErrorCode(code: number): code is ErrorCodes.CodeTypes {
  return Object.values(ErrorCodes).includes(code as ErrorCodes.CodeTypes);
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

  const validCodes: ErrorCodes.CodeTypes[] = [];
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
    codes: validCodes.length > 0 ? validCodes : ErrorCodes.allErrorCodes,
    lineNumber: node.startPosition.row,
    invalidCodes: invalidCodes.length > 0 ? invalidCodes : undefined,
  };
}

/**
 * Represents a diagnostic control point that affects code diagnostics
 */
interface DiagnosticControlPoint {
  line: number;
  action: DiagnosticAction;
  codes: ErrorCodes.CodeTypes[];
  isNextLine?: boolean;
}

/**
 * Structure to track diagnostic state at a specific line
 */
interface LineState {
  enabledCodes: Set<ErrorCodes.CodeTypes>;
}

export class DiagnosticCommentsHandler {
  // Original stack-based state for compatibility during parsing
  private stateStack: DiagnosticState[] = [];

  // Track all control points (sorted by line number) for position-based lookups
  private controlPoints: DiagnosticControlPoint[] = [];

  // Map of line numbers to their effective states (calculated at the end)
  private lineStateMap: Map<number, LineState> = new Map();

  // Track invalid codes for reporting
  public invalidCodeWarnings: Map<number, string[]> = new Map();

  // Cached enabled comments for current state
  public enabledComments: ErrorCodes.CodeTypes[] = [];

  constructor() {
    // Initialize with global state
    this.pushState(this.initialState);
    this.enabledComments = Array.from(this.currentState.enabledCodes);
  }

  private get initialState(): DiagnosticState {
    return {
      enabledCodes: new Set(this.globalEnabledCodes()),
      comment: {
        action: 'enable',
        target: 'line',
        codes: this.globalEnabledCodes(),
        lineNumber: -1,
      },
    };
  }

  private get rootState(): DiagnosticState {
    return this.stateStack[0]!;
  }

  private get currentState(): DiagnosticState {
    return this.stateStack[this.stateStack.length - 1]!;
  }

  private globalEnabledCodes(): ErrorCodes.CodeTypes[] {
    const codes = ErrorCodes.allErrorCodes;
    if (config.fish_lsp_diagnostic_disable_error_codes.length > 0) {
      return codes.filter(
        code => !config.fish_lsp_diagnostic_disable_error_codes.includes(code),
      ).filter(code => ErrorCodes.nonDeprecatedErrorCodes.some(e => e.code === code));
    }
    return codes.filter(code =>
      ErrorCodes.nonDeprecatedErrorCodes.some(e => e.code === code),
    );
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

  /**
   * Process a node for diagnostic comments
   * This maintains both the stack state and records control points
   */
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

    // Process the comment for both backward compatibility and position-based lookups
    this.processComment(comment);
  }

  private processComment(comment: DiagnosticComment) {
    // Update stack-based state (for backward compatibility)
    const newEnabledCodes = new Set(this.currentState.enabledCodes);

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

    // Update control points for position-based lookups
    const controlPoint: DiagnosticControlPoint = {
      line: comment.lineNumber,
      action: comment.action,
      codes: comment.codes,
      isNextLine: comment.target === 'next-line',
    };

    this.controlPoints.push(controlPoint);
    // Keep control points sorted by line number
    this.controlPoints.sort((a, b) => a.line - b.line);

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

  /**
   * This method is called when all nodes have been processed
   * It computes the effective state for each line in the document
   */
  public finalizeStateMap(maxLine: number): void {
    // Start with initial state
    let currentState: LineState = {
      enabledCodes: new Set(this.globalEnabledCodes()),
    };

    // Process all regular control points first
    const regularPoints = this.controlPoints.filter(p => !p.isNextLine);
    const nextLinePoints: Map<number, DiagnosticControlPoint[]> = new Map();

    // Group next-line control points by target line
    for (const point of this.controlPoints) {
      if (point.isNextLine) {
        const targetLine = point.line + 1;
        const existing = nextLinePoints.get(targetLine) || [];
        existing.push({ ...point, line: targetLine });
        nextLinePoints.set(targetLine, existing);
      }
    }

    // Build line by line state
    for (let line = 0; line <= maxLine; line++) {
      // Apply regular control points for this line
      for (const point of regularPoints) {
        if (point.line <= line) {
          this.applyControlPointToState(currentState, point);
        }
      }

      // Save the state before applying next-line directives
      const baseState = {
        enabledCodes: new Set(currentState.enabledCodes),
      };

      // Apply next-line directives for this line only
      const nextLineDirs = nextLinePoints.get(line) || [];
      for (const directive of nextLineDirs) {
        this.applyControlPointToState(currentState, directive);
      }

      // Store state for this line
      this.lineStateMap.set(line, {
        enabledCodes: new Set(currentState.enabledCodes),
      });

      // Restore base state after next-line directives
      if (nextLineDirs.length > 0) {
        currentState = baseState;
      }
    }
  }

  private applyControlPointToState(state: LineState, point: DiagnosticControlPoint): void {
    if (point.action === 'disable') {
      // Disable specified codes
      for (const code of point.codes) {
        state.enabledCodes.delete(code);
      }
    } else {
      // Enable specified codes
      for (const code of point.codes) {
        state.enabledCodes.add(code);
      }
    }
  }

  public isCodeEnabledAtNode(code: ErrorCodes.CodeTypes, node: SyntaxNode): boolean {
    const position = { line: node.startPosition.row, character: node.startPosition.column };
    return this.isCodeEnabledAtPosition(code, position);
  }

  /**
   * Check if a specific diagnostic code is enabled at a given position
   * Will use the pre-computed state if available, otherwise computes on-demand
   */
  public isCodeEnabledAtPosition(code: ErrorCodes.CodeTypes, position: Position): boolean {
    if (this.lineStateMap.has(position.line)) {
      // Use pre-computed state if available
      const state = this.lineStateMap.get(position.line)!;
      return state.enabledCodes.has(code);
    }

    // Compute state on-demand if not pre-computed
    return this.computeStateAtPosition(position).enabledCodes.has(code);
  }

  /**
   * Compute state at a position on-demand (used if finalizeStateMap hasn't been called)
   */
  private computeStateAtPosition(position: Position): LineState {
    // Start with global state
    const state: LineState = {
      enabledCodes: new Set(this.globalEnabledCodes()),
    };

    // Apply all regular control points up to this position
    for (const point of this.controlPoints) {
      if (point.line > position.line) {
        break; // Skip control points after this position
      }

      if (!point.isNextLine && point.line <= position.line) {
        this.applyControlPointToState(state, point);
      }

      // Apply next-line directives for the specific line
      if (point.isNextLine && point.line + 1 === position.line) {
        this.applyControlPointToState(state, { ...point, line: position.line });
      }
    }

    return state;
  }

  /**
   * Check if a specific diagnostic code is enabled in the current state
   * This is for backward compatibility during parsing
   */
  public isCodeEnabled(code: ErrorCodes.CodeTypes): boolean {
    return this.currentState.enabledCodes.has(code);
  }

  public isRootEnabled(code: ErrorCodes.CodeTypes): boolean {
    return this.rootState.enabledCodes.has(code);
  }

  public getStackDepth(): number {
    return this.stateStack.length;
  }

  public getCurrentState(): DiagnosticState {
    return this.currentState;
  }

  public * stateIterator(): IterableIterator<DiagnosticState> {
    for (const state of this.stateStack) {
      yield state;
    }
  }

  /**
   * For debugging/testing - get verbose state information
   */
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

    const lineStates = Array.from(this.lineStateMap.entries())
      .map(([line, state]) => `Line ${line}: ${Array.from(state.enabledCodes).length} enabled codes`);

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
      controlPoints: this.controlPoints.length,
      lineStates: lineStates.slice(0, 10), // Show first 10 for brevity
    };
  }
}
