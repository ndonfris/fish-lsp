import { CodeActionKind } from 'vscode-languageserver';

// Define our supported code action kinds
export const SupportedCodeActionKinds = {
  QuickFix: CodeActionKind.QuickFix,
  RefactorExtract: `${CodeActionKind.Refactor}.extract`,
  RefactorRewrite: `${CodeActionKind.Refactor}.rewrite`,
  Disable: `${CodeActionKind.QuickFix}.disable`,
} as const;
