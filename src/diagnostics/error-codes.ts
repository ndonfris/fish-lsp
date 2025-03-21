import { CodeDescription, DiagnosticSeverity } from 'vscode-languageserver';

export namespace ErrorCodes {

  export const missingEnd = 1001;
  export const extraEnd = 1002;
  export const zeroIndexedArray = 1003;
  export const sourceFileDoesNotExist = 1004;

  export const singleQuoteVariableExpansion = 2001;
  export const usedAlias = 2002;
  export const usedUnviersalDefinition = 2003;

  export const testCommandMissingStringCharacters = 3001;
  export const missingQuietOption = 3002;
  export const expansionInDefinition = 3003;

  export const autoloadedFunctionMissingDefinition = 4001;
  export const autoloadedFunctionFilenameMismatch = 4002;
  export const functionNameUsingReservedKeyword = 4003;
  export const unusedLocalFunction = 4004;
  // export const preferAutloadedFunctionHasDescription = 4005;

  export const argparseMissingEndStdin = 5001;

  export const fishLspDeprecatedEnvName = 6001;

  export const invalidDiagnosticCode = 8001;

  export const syntaxError = 9999;

  export type CodeTypes =
    1001 | 1002 | 1003 | 1004 |
    2001 | 2002 | 2003 |
    3001 | 3002 | 3003 |
    4001 | 4002 | 4003 | 4004 |
    5001 |
    6001 |
    8001 |
    9999 ;

  export type CodeValueType = {
    severity: DiagnosticSeverity;
    code: CodeTypes;
    codeDescription: CodeDescription;
    source: 'fish-lsp';
    message: string;
  };

  export type DiagnosticCode = {
    [k in CodeTypes]: CodeValueType;
  };

  export const codes: { [k in CodeTypes]: CodeValueType } = {
    [missingEnd]: {
      severity: DiagnosticSeverity.Error,
      code: missingEnd,
      codeDescription: { href: 'https://fishshell.com/docs/current/cmds/end.html' },
      source: 'fish-lsp',
      message: 'missing closing token',
    },
    [extraEnd]: {
      severity: DiagnosticSeverity.Error,
      code: extraEnd,
      codeDescription: { href: 'https://fishshell.com/docs/current/cmds/end.html' },
      source: 'fish-lsp',
      message: 'extra closing token',
    },
    [zeroIndexedArray]: {
      severity: DiagnosticSeverity.Error,
      code: zeroIndexedArray,
      codeDescription: { href: 'https://fishshell.com/docs/current/language.html#slices' },
      source: 'fish-lsp',
      message: 'invalid array index',
    },
    [sourceFileDoesNotExist]: {
      severity: DiagnosticSeverity.Error,
      code: sourceFileDoesNotExist,
      codeDescription: { href: 'https://fishshell.com/docs/current/cmds/source.html' },
      source: 'fish-lsp',
      message: 'source filename does not exist',
    },
    [singleQuoteVariableExpansion]: {
      severity: DiagnosticSeverity.Warning,
      code: singleQuoteVariableExpansion,
      codeDescription: { href: 'https://fishshell.com/docs/current/language.html#variable-expansion' },
      source: 'fish-lsp',
      message: 'non-escaped expansion variable in single quote string',
    },
    [usedAlias]: {
      severity: DiagnosticSeverity.Warning,
      code: usedAlias,
      codeDescription: { href: 'https://fishshell.com/docs/current/cmds/alias.html' },
      source: 'fish-lsp',
      message: 'alias used, prefer using functions instead',
    },
    [usedUnviersalDefinition]: {
      severity: DiagnosticSeverity.Warning,
      code: usedUnviersalDefinition,
      codeDescription: { href: 'https://fishshell.com/docs/current/language.html#universal-variables' },
      source: 'fish-lsp',
      message: 'Universal scope set in non-interactive session',
    },
    [testCommandMissingStringCharacters]: {
      severity: DiagnosticSeverity.Warning,
      code: testCommandMissingStringCharacters,
      codeDescription: { href: 'https://fishshell.com/docs/current/cmds/test.html#examples' },
      source: 'fish-lsp',
      message: 'test command string check, should be wrapped as a string',
    },
    [missingQuietOption]: {
      severity: DiagnosticSeverity.Warning,
      code: missingQuietOption,
      codeDescription: { href: 'https://fishshell.com/docs/current/search.html?q=-q' },
      source: 'fish-lsp',
      message: 'Conditional command should include a silence option',
    },
    [expansionInDefinition]: {
      severity: DiagnosticSeverity.Warning,
      code: expansionInDefinition,
      codeDescription: { href: 'https://fishshell.com/docs/current/cmds/set.html' },
      source: 'fish-lsp',
      message: 'Variable definition should not include expansion character',
    },
    [autoloadedFunctionMissingDefinition]: {
      severity: DiagnosticSeverity.Warning,
      code: autoloadedFunctionMissingDefinition,
      codeDescription: { href: 'https://fishshell.com/docs/current/cmds/functions.html' },
      source: 'fish-lsp',
      message: 'Autoloaded function missing definition',
    },
    [autoloadedFunctionFilenameMismatch]: {
      severity: DiagnosticSeverity.Error,
      code: autoloadedFunctionFilenameMismatch,
      codeDescription: { href: 'https://fishshell.com/docs/current/cmds/functions.html' },
      source: 'fish-lsp',
      message: 'Autoloaded filename does not match function name',
    },
    [functionNameUsingReservedKeyword]: {
      severity: DiagnosticSeverity.Error,
      code: functionNameUsingReservedKeyword,
      codeDescription: { href: 'https://fishshell.com/docs/current/cmds/functions.html' },
      source: 'fish-lsp',
      message: 'Function name uses reserved keyword',
    },
    [unusedLocalFunction]: {
      severity: DiagnosticSeverity.Warning,
      code: unusedLocalFunction,
      codeDescription: { href: 'https://fishshell.com/docs/current/cmds/functions.html' },
      source: 'fish-lsp',
      message: 'Unused local function',
    },
    [argparseMissingEndStdin]: {
      severity: DiagnosticSeverity.Error,
      code: argparseMissingEndStdin,
      codeDescription: { href: 'https://fishshell.com/docs/current/cmds/argparse.html' },
      source: 'fish-lsp',
      message: 'argparse missing end of stdin',
    },
    [fishLspDeprecatedEnvName]: {
      severity: DiagnosticSeverity.Warning,
      code: fishLspDeprecatedEnvName,
      codeDescription: { href: 'https://github.com/ndonfris/fish-lsp#environment-variables' },
      source: 'fish-lsp',
      message: 'Deprecated fish-lsp environment variable name',
    },
    [invalidDiagnosticCode]: {
      severity: DiagnosticSeverity.Warning,
      code: invalidDiagnosticCode,
      codeDescription: { href: 'https://github.com/ndonfris/fish-lsp/wiki/Diagnostic-Error-Codes' },
      source: 'fish-lsp',
      message: 'Invalid diagnostic control code',
    },
    [syntaxError]: {
      severity: DiagnosticSeverity.Error,
      code: syntaxError,
      codeDescription: { href: 'https://fishshell.com/docs/current/fish_for_bash_users.html#syntax-overview' },
      source: 'fish-lsp',
      message: 'fish syntax error',
    },
  };

  /** All error codes */
  export const allErrorCodes = Object.values(codes).map((diagnostic) => diagnostic.code) as CodeTypes[];

  export function getSeverityString(severity: DiagnosticSeverity | undefined): string {
    if (!severity) return '';
    switch (severity) {
      case DiagnosticSeverity.Error:
        return 'Error';
      case DiagnosticSeverity.Warning:
        return 'Warning';
      case DiagnosticSeverity.Information:
        return 'Information';
      case DiagnosticSeverity.Hint:
        return 'Hint';
      default:
        return '';
    }
  }

  export function getDiagnostic(code: CodeTypes | number): CodeValueType {
    if (typeof code === 'number') return codes[code as CodeTypes];
    return codes[code];
  }
}
