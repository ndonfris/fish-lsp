import { CodeActionKind } from 'vscode-languageserver';

// Define our supported code action kinds
export const SupportedCodeActionKinds = {
  QuickFix: `${CodeActionKind.QuickFix}`,
  RefactorRewrite: `${CodeActionKind.Refactor}.rewrite`,
  RefactorExtract: `${CodeActionKind.Refactor}.extract`,
  Disable: `${CodeActionKind.QuickFix}.disable`,
} as const;
