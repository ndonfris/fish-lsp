/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as LSP from 'vscode-languageserver';
import { CodeActionTriggerKind } from 'vscode-languageserver';
import { LspDocument } from './document';

export class CodeActionKind {
  private static readonly sep = '.';

  public static readonly Empty = new CodeActionKind(LSP.CodeActionKind.Empty);

  public static readonly Refactor = new CodeActionKind(LSP.CodeActionKind.Refactor);
  public static readonly RefactorToFunction = CodeActionKind.Refactor.append('function');
  public static readonly RefactorToVariable = CodeActionKind.Refactor.append('variable');

  public static readonly QuickFix = new CodeActionKind(LSP.CodeActionKind.QuickFix);
  public static readonly QuickFixFunctionName = CodeActionKind.QuickFix.append('functionName');
  public static readonly QuickFixExtraEnd = CodeActionKind.QuickFix.append('extraEnd');
  public static readonly QuickFixMissingEnd = CodeActionKind.QuickFix.append('missingEnd');

  public static readonly Source = new CodeActionKind(LSP.CodeActionKind.Source);
  public static readonly SourceRemoveUnused = CodeActionKind.Source.append('removeUnused');
  public static readonly SourceRemoveUnreachable = CodeActionKind.Source.append('removeUnreachable');

  public static readonly SourceFixAll = new CodeActionKind(LSP.CodeActionKind.SourceFixAll);

  constructor(public readonly value: string) { }

  public equals(other: CodeActionKind): boolean {
    return this.value === other.value;
  }

  /**
     * Checks if `other` is a sub-kind of this `CodeActionKind`.
     *
     * The kind `"refactor.extract"` for example contains `"refactor.extract"` and ``"refactor.extract.function"`,
     * but not `"unicorn.refactor.extract"`, or `"refactor.extractAll"` or `refactor`.
     *
     * @param other Kind to check.
     */
  public contains(other: CodeActionKind): boolean {
    return this.equals(other) || this.value === '' || other.value.startsWith(this.value + CodeActionKind.sep);
  }

  /**
     * Checks if this code action kind intersects `other`.
     *
     * The kind `"refactor.extract"` for example intersects `refactor`, `"refactor.extract"` and ``"refactor.extract.function"`,
     * but not `"unicorn.refactor.extract"`, or `"refactor.extractAll"`.
     *
     * @param other Kind to check.
     */
  public intersects(other: CodeActionKind): boolean {
    return this.contains(other) || other.contains(this);
  }

  /**
     * Create a new kind by appending a more specific selector to the current kind.
     *
     * Does not modify the current kind.
     */
  public append(part: string): CodeActionKind {
    return new CodeActionKind(this.value + CodeActionKind.sep + part);
  }
}

export enum FishLspCodeActionTriggerKind {
  ALL,
  REFACTOR,
  QUICKFIX,
}

export function getTriggerKind(document: LspDocument, params: LSP.CodeActionParams): FishLspCodeActionTriggerKind {
  const range = params.range;
  if (range.start.line === 0 && range.start.character === 0
        && range.end.line === document.lineCount - 1 && range.end.character === 0) {
    return FishLspCodeActionTriggerKind.ALL;
  } else {
    return FishLspCodeActionTriggerKind.REFACTOR;
  }
}
