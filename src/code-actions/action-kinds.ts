import { CodeActionKind } from 'vscode-languageserver';

// Define our supported code action kinds
export const SupportedCodeActionKinds = {
  QuickFix: `${CodeActionKind.QuickFix}.fix`,
  Disable: `${CodeActionKind.QuickFix}.disable`,
  QuickFixAll: `${CodeActionKind.QuickFix}.fixAll`,
  QuickFixDelete: `${CodeActionKind.QuickFix}.delete`,
  RefactorRewrite: `${CodeActionKind.Refactor}.rewrite`,
  RefactorExtract: `${CodeActionKind.Refactor}.extract`,
  SourceRename: `${CodeActionKind.Source}.rename`,
} as const;

export type SupportedCodeActionKinds = typeof SupportedCodeActionKinds[keyof typeof SupportedCodeActionKinds];

export const AllSupportedActions = Object.values(SupportedCodeActionKinds);
