import { CodeDescription, Diagnostic, DiagnosticSeverity } from 'vscode-languageserver'


export namespace ErrorCodes {

  export const missingEnd = 1001
  export const extraEnd = 1002
  export const zeroIndexedArray = 1003
  export const sourceFileDoesNotExist = 1004
  
  export const singleQuoteVariableExpansion = 2001
  export const usedAlias = 2002
  export const usedUnviersalDefinition = 2003

  export const testCommandMissingStringCharacters = 3001
  export const missingQuietOption = 3002
  export const expansionInDefinition = 3003

  type codeTypes = 1001 | 1002 | 1003 | 1004 | 2001 | 2002 | 2003 | 3001 | 3002 | 3003

  type CodeValueType = {
    severity: DiagnosticSeverity
    code: codeTypes
    codeDescription: CodeDescription
    source: 'fish-lsp'
    message: string
  }

  export const codes: {[k in codeTypes]: CodeValueType} = {
    [missingEnd]: {
      severity: DiagnosticSeverity.Error,
      code: missingEnd,
      codeDescription: {href: 'https://fishshell.com/docs/current/cmds/end.html'},
      source: 'fish-lsp',
      message: 'missing closing token'
    },
    [extraEnd]: {
      severity: DiagnosticSeverity.Error,
      code: extraEnd,
      codeDescription: {href: 'https://fishshell.com/docs/current/cmds/end.html'},
      source: 'fish-lsp',
      message: 'extra closing token'
    },
    [zeroIndexedArray]: {
      severity: DiagnosticSeverity.Error,
      code: zeroIndexedArray,
      codeDescription: {href: 'https://fishshell.com/docs/current/language.html#slices'},
      source: 'fish-lsp',
      message: 'invalid array index'
    },
    [sourceFileDoesNotExist]: {
      severity: DiagnosticSeverity.Error,
      code: sourceFileDoesNotExist,
      codeDescription: {href: 'https://fishshell.com/docs/current/cmds/source.html'},
      source: 'fish-lsp',
      message: 'source filename does not exist'
    },
    [singleQuoteVariableExpansion]: {
      severity: DiagnosticSeverity.Warning,
      code: singleQuoteVariableExpansion,
      codeDescription: {href: 'https://fishshell.com/docs/current/language.html#variable-expansion'},
      source: 'fish-lsp',
      message: 'non-escaped expansion variable in single quote string'
    },
    [usedAlias]: {
      severity: DiagnosticSeverity.Warning,
      code: usedAlias,
      codeDescription: {href: 'https://fishshell.com/docs/current/cmds/alias.html'},
      source: 'fish-lsp',
      message: 'alias used, prefer using functions instead'
    },
    [usedUnviersalDefinition]: {
      severity: DiagnosticSeverity.Warning,
      code: usedUnviersalDefinition,
      codeDescription: {href: 'https://fishshell.com/docs/current/language.html#universal-variables'},
      source: 'fish-lsp',
      message: 'Universal scope set in non-interactive session'
    },
    [testCommandMissingStringCharacters]: {
      severity: DiagnosticSeverity.Warning,
      code: testCommandMissingStringCharacters,
      codeDescription: {href: 'https://fishshell.com/docs/current/cmds/test.html#examples'},
      source: 'fish-lsp',
      message: 'test command string check, should be wrapped as a string'
    },
    [missingQuietOption]: {
      severity: DiagnosticSeverity.Warning,
      code: missingQuietOption,
      codeDescription: {href: 'https://fishshell.com/docs/current/search.html?q=-q'},
      source: 'fish-lsp',
      message: 'Conditional command should include a silence option'
    },
    [expansionInDefinition]: {
      severity: DiagnosticSeverity.Warning,
      code: missingQuietOption,
      codeDescription: {href: 'https://fishshell.com/docs/current/cmds/set.html'},
      source: 'fish-lsp',
      message: 'Variable definition should not include expansion character'
    }
  }
}

