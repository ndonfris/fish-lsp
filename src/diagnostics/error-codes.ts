import { CodeDescription, DiagnosticSeverity } from 'vscode-languageserver';

export namespace ErrorCodes {

  export const missingEnd = 1001;
  export const extraEnd = 1002;
  export const zeroIndexedArray = 1003;
  export const sourceFileDoesNotExist = 1004;
  export const dotSourceCommand = 1005;

  export const singleQuoteVariableExpansion = 2001;
  export const usedWrapperFunction = 2002;
  export const usedUnviersalDefinition = 2003;
  export const usedExternalShellCommandWhenBuiltinExists = 2004;

  export const testCommandMissingStringCharacters = 3001;
  export const missingQuietOption = 3002;
  export const dereferencedDefinition = 3003;

  export const autoloadedFunctionMissingDefinition = 4001;
  export const autoloadedFunctionFilenameMismatch = 4002;
  export const functionNameUsingReservedKeyword = 4003;
  export const unusedLocalDefinition = 4004;
  export const autoloadedCompletionMissingCommandName = 4005;
  export const duplicateFunctionDefinitionInSameScope = 4006;
  export const autoloadedFunctionWithEventHookUnused = 4007;
  export const requireAutloadedFunctionHasDescription = 4008;

  export const argparseMissingEndStdin = 5001;
  export const unreachableCode = 5555;

  export const fishLspDeprecatedEnvName = 6001;

  export const invalidDiagnosticCode = 8001;

  export const syntaxError = 9999;

  export type CodeTypes =
    1001 | 1002 | 1003 | 1004 | 1005 |
    2001 | 2002 | 2003 | 2004 |
    3001 | 3002 | 3003 |
    4001 | 4002 | 4003 | 4004 | 4005 | 4006 | 4007 | 4008 |
    5001 | 5555 |
    6001 |
    8001 |
    9999;

  export type CodeValueType = {
    severity: DiagnosticSeverity;
    code: CodeTypes;
    codeDescription: CodeDescription;
    source: 'fish-lsp';
    isDeprecated?: boolean;
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
    [dotSourceCommand]: {
      severity: DiagnosticSeverity.Error,
      code: dotSourceCommand,
      codeDescription: { href: 'https://fishshell.com/docs/current/cmds/source.html' },
      source: 'fish-lsp',
      message: '`.` source command not allowed, use `source` instead',
    },
    /** consider disabling this */
    [singleQuoteVariableExpansion]: {
      severity: DiagnosticSeverity.Warning,
      code: singleQuoteVariableExpansion,
      codeDescription: { href: 'https://fishshell.com/docs/current/language.html#variable-expansion' },
      source: 'fish-lsp',
      isDeprecated: true,
      message: 'non-escaped expansion variable in single quote string',
    },
    [usedWrapperFunction]: {
      severity: DiagnosticSeverity.Warning,
      code: usedWrapperFunction,
      codeDescription: { href: 'https://fishshell.com/docs/current/commands.html' },
      source: 'fish-lsp',
      message: 'Wrapper command (`export`, `alias`, etc.) used, while preferring usage of primitive commands.\n\nUse command: \n```fish\nset -gx fish_lsp_allow_fish_wrapper_functions true\n```\nto disable this warning globally.',
    },
    [usedUnviersalDefinition]: {
      severity: DiagnosticSeverity.Warning,
      code: usedUnviersalDefinition,
      codeDescription: { href: 'https://fishshell.com/docs/current/language.html#universal-variables' },
      source: 'fish-lsp',
      message: 'Universal scope set in non-interactive session',
    },
    [usedExternalShellCommandWhenBuiltinExists]: {
      severity: DiagnosticSeverity.Warning,
      code: usedExternalShellCommandWhenBuiltinExists,
      codeDescription: { href: 'https://fishshell.com/docs/current/cmds/builtins.html' },
      source: 'fish-lsp',
      message: 'External shell command used when equivalent fish builtin exists',
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
    [dereferencedDefinition]: {
      severity: DiagnosticSeverity.Warning,
      code: dereferencedDefinition,
      codeDescription: { href: 'https://fishshell.com/docs/current/language.html#dereferencing-variables' },
      source: 'fish-lsp',
      message: 'Dereferenced variable could be undefined',
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
    [unusedLocalDefinition]: {
      severity: DiagnosticSeverity.Warning,
      code: unusedLocalDefinition,
      codeDescription: { href: 'https://fishshell.com/docs/current/language.html#local-variables' },
      source: 'fish-lsp',
      message: 'Unused local',
    },
    [autoloadedCompletionMissingCommandName]: {
      severity: DiagnosticSeverity.Error,
      code: autoloadedCompletionMissingCommandName,
      codeDescription: { href: 'https://fishshell.com/docs/current/cmds/complete.html' },
      source: 'fish-lsp',
      message: 'Autoloaded completion missing command name',
    },
    [duplicateFunctionDefinitionInSameScope]: {
      severity: DiagnosticSeverity.Warning,
      code: duplicateFunctionDefinitionInSameScope,
      codeDescription: { href: 'https://fishshell.com/docs/current/cmds/functions.html' },
      source: 'fish-lsp',
      message: 'Duplicate function definition exists in the same scope.\n\nAmbiguous function',
    },
    [autoloadedFunctionWithEventHookUnused]: {
      severity: DiagnosticSeverity.Warning,
      code: autoloadedFunctionWithEventHookUnused,
      codeDescription: { href: 'https://fishshell.com/docs/current/language.html#event' },
      source: 'fish-lsp',
      message: 'Autoloaded function with event hook is unused',
    },
    [requireAutloadedFunctionHasDescription]: {
      severity: DiagnosticSeverity.Warning,
      code: requireAutloadedFunctionHasDescription,
      codeDescription: { href: 'https://fishshell.com/docs/current/cmds/functions.html' },
      source: 'fish-lsp',
      message: 'Autoloaded function requires a description | Add `-d`/`--description` to the function definition',
    },
    [argparseMissingEndStdin]: {
      severity: DiagnosticSeverity.Error,
      code: argparseMissingEndStdin,
      codeDescription: { href: 'https://fishshell.com/docs/current/cmds/argparse.html' },
      source: 'fish-lsp',
      message: 'argparse missing end of stdin',
    },
    [unreachableCode]: {
      severity: DiagnosticSeverity.Warning,
      code: unreachableCode,
      codeDescription: { href: 'https://fishshell.com/docs/current/language.html#unreachable-code-blocks' },
      source: 'fish-lsp',
      message: 'Unreachable code blocks detected',
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

  export const allErrorCodeObjects = Object.values(codes) as CodeValueType[];

  export const nonDeprecatedErrorCodes = allErrorCodeObjects.filter((code) => !code.isDeprecated);

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

  export function codeTypeGuard(code: CodeTypes | number | string | undefined): code is CodeTypes {
    return typeof code === 'number' && code >= 1000 && code < 10000 && allErrorCodes.includes(code as CodeTypes);
  }

  export function getDiagnostic(code: CodeTypes | number): CodeValueType {
    if (typeof code === 'number') return codes[code as CodeTypes];
    return codes[code];
  }
}
