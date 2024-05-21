import { Diagnostic, TextDocumentEdit, RemoteClient, Connection, CodeAction } from 'vscode-languageserver';
//import { LspClient } from '../client';
import { CodeActionKind } from '../code-action';
import { Commands, FishRenameRequest } from '../commands';
import { LspDocuments } from '../document';
import FishServer from '../server';
import * as errorCodes from '../diagnostics/errorCodes';
import * as fixNames from '../diagnostics/fixNames';
import { FishProtocol } from '../utils/fishProtocol';
import { Range } from '../utils/locations';
import { pathToRelativeFunctionName, toTextDocumentEdit } from '../utils/translation';

import CommandTypes = FishProtocol.CommandTypes;

interface AutoFix {
  readonly code: number;
  readonly fixName: string;
}

export async function buildIndividualFixes(
  fixes: readonly AutoFix[],
  connection: Connection,
  file: string,
  documents: LspDocuments,
  diagnostics: readonly Diagnostic[],
): Promise<TextDocumentEdit[]> {
  const edits: TextDocumentEdit[] = [];
  for (const diagnostic of diagnostics) {
    for (const { code, fixName } of fixes) {
      if (code !== diagnostic.code) {
        continue;
      }

      const args: FishProtocol.CodeFixRequestArgs = {
        ...Range.toFileRangeRequestArgs(file, diagnostic.range),
        errorCodes: [+diagnostic.code!],
      };

      const response : FishProtocol.Response = await connection.sendRequest(CommandTypes.GetCodeFixes, args);
      if (response.type !== 'response') {
        continue;
      }

      const fix = response.body?.find((fix: AutoFix) => fix.fixName === fixName);
      if (fix) {
        edits.push(...fix.changes.map((change: FishProtocol.FileCodeEdits) => toTextDocumentEdit(change, documents)));
        break;
      }
    }
  }
  return edits;
}

async function buildCombinedFix(
  fixes: readonly AutoFix[],
  connection: Connection,
  file: string,
  documents: LspDocuments,
  diagnostics: readonly Diagnostic[],
): Promise<TextDocumentEdit[]> {
  const edits: TextDocumentEdit[] = [];
  for (const diagnostic of diagnostics) {
    for (const { code, fixName } of fixes) {
      if (code !== diagnostic.code) {
        continue;
      }

      const args: FishProtocol.CodeFixRequestArgs = {
        ...Range.toFileRangeRequestArgs(file, diagnostic.range),
        errorCodes: [+diagnostic.code!],
      };

      const response: FishProtocol.Response = await connection.sendRequest(CommandTypes.GetCodeFixes, args);
      if (response.type !== 'response' || !response.body?.length) {
        continue;
      }

      const fix = response.body?.find((fix: AutoFix) => fix.fixName === fixName);
      if (!fix) {
        continue;
      }
      if (!fix.fixId) {
        edits.push(...fix.changes.map((change: FishProtocol.FileCodeEdits) => toTextDocumentEdit(change, documents)));
        return edits;
      }

      const combinedArgs: FishProtocol.GetCombinedCodeFixRequestArgs = {
        scope: {
          type: 'file',
          args: { file },
        },
        fixId: fix.fixId,
      };
      const combinedResponse: FishProtocol.Response = await connection.sendRequest(CommandTypes.GetCombinedCodeFix, combinedArgs);
      if (combinedResponse.type !== 'response' || !combinedResponse.body) {
        return edits;
      }

      edits.push(...combinedResponse.body.changes.map((change: FishProtocol.FileCodeEdits) => toTextDocumentEdit(change, documents)));
      return edits;
    }
  }
  return edits;
}

abstract class SourceAction {
  abstract build(
    connection: Connection, // might need to use client, instead of sending from server
    file: string,
    documents: LspDocuments,
    diagnostics: readonly Diagnostic[]
  ): Promise<CodeAction | null>;
}

class SourceFixAll extends SourceAction {
  private readonly title = 'Fix all';
  static readonly kind = CodeActionKind.SourceFixAll;

  async build(
    connection: Connection,
    file: string,
    documents: LspDocuments,
    diagnostics: readonly Diagnostic[],
  ): Promise<CodeAction | null> {
    const edits = await buildCombinedFix([
      { code: errorCodes.unreachableCode, fixName: fixNames.unreachableCode },
      { code: errorCodes.missingEnd, fixName: fixNames.addMissingEnd },
      { code: errorCodes.missingAutoloadedFunctionName, fixName: fixNames.incorrectFunctionName },
      { code: errorCodes.unusedIdentifier, fixName: fixNames.unusedIdentifier },
    ], connection, file, documents, diagnostics);
    if (!edits.length) {
      return null;
    }
    return CodeAction.create(this.title, { documentChanges: edits }, SourceRemoveUnused.kind.value);
  }
}

class QuickFixFunctionName extends SourceAction {
  private title = 'change function name to match path';
  static readonly kind = CodeActionKind.QuickFixFunctionName;

  async build(
    connection: Connection,
    file: string,
    documents: LspDocuments,
    diagnostics: readonly Diagnostic[],
  ): Promise<CodeAction | null> {
    const newName = pathToRelativeFunctionName(file);
    this.title = newName.length ? `change function name to ${newName}` : this.title;
    const edits = await buildCombinedFix([
      { code: errorCodes.missingAutoloadedFunctionName, fixName: fixNames.incorrectFunctionName },
    ], connection, file, documents, diagnostics);
    if (!edits.length) {
      return null;
    }
    return CodeAction.create(this.title, { documentChanges: edits }, SourceRemoveUnused.kind.value);
  }
}
class QuickFixMissingEnd extends SourceAction {
  private readonly title = 'add all missing "end" keywords';
  static readonly kind = CodeActionKind.QuickFixMissingEnd;

  async build(
    connection: Connection,
    file: string,
    documents: LspDocuments,
    diagnostics: readonly Diagnostic[],
  ): Promise<CodeAction | null> {
    const edits = await buildCombinedFix([
      { code: errorCodes.missingEnd, fixName: fixNames.addMissingEnd },
    ], connection, file, documents, diagnostics);
    if (!edits.length) {
      return null;
    }
    return CodeAction.create(this.title, { documentChanges: edits }, SourceRemoveUnused.kind.value);
  }
}

class SourceRemoveUnused extends SourceAction {
  private readonly title = 'Remove all unused code';
  static readonly kind = CodeActionKind.SourceRemoveUnused;

  async build(
    connection: Connection,
    file: string,
    documents: LspDocuments,
    diagnostics: readonly Diagnostic[],
  ): Promise<CodeAction | null> {
    const edits = await buildCombinedFix([
      { code: errorCodes.unusedIdentifier, fixName: fixNames.unusedIdentifier },
    ], connection, file, documents, diagnostics);
    if (!edits.length) {
      return null;
    }
    return CodeAction.create(this.title, { documentChanges: edits }, SourceRemoveUnused.kind.value);
  }
}

class SourceRemoveUnreachable extends SourceAction {
  private readonly title = 'Remove all unreachable code';
  static readonly kind = CodeActionKind.SourceRemoveUnreachable;

  async build(
    connection: Connection,
    file: string,
    documents: LspDocuments,
    diagnostics: readonly Diagnostic[],
  ): Promise<CodeAction | null> {
    const edits = await buildCombinedFix([
      { code: errorCodes.unreachableCode, fixName: fixNames.unreachableCode },
    ], connection, file, documents, diagnostics);
    if (!edits.length) {
      return null;
    }
    return CodeAction.create(this.title, { documentChanges: edits }, SourceRemoveUnused.kind.value);
  }
}

export class FishAutoFixProvider {
  private static kindProviders = [
    QuickFixFunctionName,
    QuickFixMissingEnd,
    SourceRemoveUnused,
    SourceRemoveUnreachable,
    SourceFixAll,
  ];

  public static get kinds(): CodeActionKind[] {
    return FishAutoFixProvider.kindProviders.map(provider => provider.kind);
  }

  constructor(private readonly connection: Connection) {}

  public async provideCodeActions(kinds: CodeActionKind[], file: string, diagnostics: Diagnostic[], documents: LspDocuments): Promise<CodeAction[]> {
    const results: Promise<CodeAction | null>[] = [];
    for (const provider of FishAutoFixProvider.kindProviders) {
      if (kinds.some(kind => kind.contains(provider.kind))) {
        results.push((new provider).build(this.connection, file, documents, diagnostics));
      }
    }
    return (await Promise.all(results)).flatMap(result => result || []);
  }
}
