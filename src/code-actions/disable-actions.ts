// src/code-actions/disable-diagnostics.ts
import { CodeAction, Diagnostic, DiagnosticSeverity, TextEdit } from 'vscode-languageserver';
import { LspDocument } from '../document';
import { ErrorCodes } from '../diagnostics/error-codes';
import { SupportedCodeActionKinds } from './action-kinds';
import { logger } from '../logger';

interface DiagnosticGroup {
  startLine: number;
  endLine: number;
  diagnostics: Diagnostic[];
}

function createDisableAction(
  title: string,
  document: LspDocument,
  edits: TextEdit[],
  diagnostics: Diagnostic[],
  isPreferred: boolean = false,
): CodeAction {
  return {
    title,
    kind: SupportedCodeActionKinds.Disable,
    edit: {
      changes: {
        [document.uri]: edits,
      },
    },
    diagnostics,
    isPreferred,
  };
}

export function handleDisableSingleLine(
  document: LspDocument,
  diagnostic: Diagnostic,
): CodeAction {
  const indent = document.getIndentAtLine(diagnostic.range.start.line);
  // Insert disable comment above the diagnostic line
  const edit = TextEdit.insert(
    { line: diagnostic.range.start.line, character: 0 },
    `${indent}# @fish-lsp-disable-next-line ${diagnostic.code}\n`,
  );

  const severity = ErrorCodes.getSeverityString(diagnostic.severity);

  return createDisableAction(
    `Disable ${severity} diagnostic ${diagnostic.code} for line ${diagnostic.range.start.line + 1}`,
    document,
    [edit],
    [diagnostic],
  );
}

export function handleDisableBlock(
  document: LspDocument,
  group: DiagnosticGroup,
): CodeAction {
  const numbers = Array.from(new Set(group.diagnostics.map(diagnostic => diagnostic.code)).values()).join(' ');
  const startIndent = document.getIndentAtLine(group.startLine);
  const endIndent = document.getIndentAtLine(group.endLine);
  const edits = [
    // Insert disable comment at start of block
    TextEdit.insert(
      { line: group.startLine, character: 0 },
      `${startIndent}# @fish-lsp-disable ${numbers}\n`,
    ),
    // Insert enable comment after end of block
    TextEdit.insert(
      { line: group.endLine + 1, character: 0 },
      `${endIndent}# @fish-lsp-enable ${numbers}\n`,
    ),
  ];

  return {
    ...createDisableAction(
      `Disable diagnostics ${numbers} in block (lines ${group.startLine + 1}-${group.endLine + 1})`,
      document,
      edits,
      group.diagnostics,
    ),
  };
}

// Group diagnostics that are adjacent or within N lines of each other
export function groupDiagnostics(diagnostics: Diagnostic[], maxGap: number = 1): DiagnosticGroup[] {
  if (diagnostics.length === 0) return [];

  // Sort diagnostics by starting line
  const sorted = [...diagnostics].sort((a, b) =>
    a.range.start.line - b.range.start.line,
  );

  const groups: DiagnosticGroup[] = [];
  let currentGroup: DiagnosticGroup = {
    startLine: sorted[0]!.range.start.line,
    endLine: sorted[0]!.range.end.line,
    diagnostics: [sorted[0]!],
  };

  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i]!;
    const gap = current.range.start.line - currentGroup.endLine;

    if (gap <= maxGap) {
      // Add to current group
      currentGroup.endLine = Math.max(currentGroup.endLine, current.range.end.line);
      currentGroup.diagnostics.push(current);
    } else {
      // Start new group
      groups.push(currentGroup);
      currentGroup = {
        startLine: current.range.start.line,
        endLine: current.range.end.line,
        diagnostics: [current],
      };
    }
  }

  // Add final group
  groups.push(currentGroup);

  return groups;
}

export function handleDisableEntireFile(
  document: LspDocument,
  diagnostics: Diagnostic[],
): CodeAction[] {
  const results: CodeAction[] = [];
  const diagnosticsCounts = new Map<keyof typeof ErrorCodes.allErrorCodes, number>();
  diagnostics.forEach(diagnostic => {
    if (ErrorCodes.codeTypeGuard(diagnostic.code)) {
      const code = ErrorCodes.getDiagnostic(diagnostic.code).code;
      diagnosticsCounts.set(code, (diagnosticsCounts.get(code) || 0) + 1);
    }
  });

  const matchingDiagnostics: Array<ErrorCodes.CodeTypes> = [];
  diagnosticsCounts.forEach((count, code) => {
    if (count >= 5) {
      logger.log(`CODEACTION: Disabling ${count} ${code.toString()} diagnostics in file`);
    }
    matchingDiagnostics.push(code as ErrorCodes.CodeTypes);
  });

  if (matchingDiagnostics.length === 0) return results;

  let tokenLine = 0;
  let firstLine = document.getLine(tokenLine);
  if (firstLine.startsWith('#!/')) {
    tokenLine++;
  }
  firstLine = document.getLine(tokenLine);
  const allNumbersStr = matchingDiagnostics.join(' ').trim();
  if (!firstLine.startsWith('# @fish-lsp-disable')) {
    const edits = [
      TextEdit.insert(
        { line: tokenLine, character: 0 },
        `# @fish-lsp-disable ${allNumbersStr}\n`,
      ),
    ];

    results.push(
      createDisableAction(
        `Disable all diagnostics in file (${allNumbersStr.split(' ').join(', ')})`,
        document,
        edits,
        diagnostics,
      ),
    );

    matchingDiagnostics.forEach(match => {
      const severity = ErrorCodes.getSeverityString(ErrorCodes.getDiagnostic(match).severity);
      results.push(
        createDisableAction(
          `Disable ${severity} ${match.toString()} diagnostics for entire file`,
          document,
          [
            TextEdit.insert({ line: tokenLine, character: 0 },
              `# @fish-lsp-disable ${match.toString()}\n`),
          ],
          diagnostics,
        ),
      );
    });
  }

  return results;
}

export function getDisableDiagnosticActions(
  document: LspDocument,
  diagnostics: Diagnostic[],
): CodeAction[] {
  const actions: CodeAction[] = [];

  const fixedDiagnostics = diagnostics
    .filter(diagnostic => !!diagnostic?.severity)
    .filter(diagnostic =>
      diagnostic?.source === 'fish-lsp' && diagnostic?.code !== ErrorCodes.invalidDiagnosticCode,
    );

  // Add single-line disable actions for each diagnostic
  fixedDiagnostics
    .filter(diagnostic =>
      diagnostic?.severity === DiagnosticSeverity.Warning
      || diagnostic.code === ErrorCodes.sourceFileDoesNotExist,
    ).forEach(diagnostic => {
      actions.push(handleDisableSingleLine(document, diagnostic));
    });

  // Add block disable actions for groups
  const groups = groupDiagnostics(fixedDiagnostics);
  groups.forEach(group => {
    // Only create block actions for multiple diagnostics
    if (group.diagnostics.length > 1) {
      actions.push(handleDisableBlock(document, group));
    }
  });
  actions.push(...handleDisableEntireFile(document, fixedDiagnostics));
  return actions;
}
