
import * as LSP from 'vscode-languageserver';
import { Commands } from '../commands';
import { toTextDocumentEdit } from '../utils/translation';
import { FishProtocol } from '../utils/fishProtocol';
import { LspDocuments } from '../document';
import { CodeAction } from 'vscode-languageserver';
import { SupportedFeatures } from '../server';

export function provideRefactor(response: FishProtocol.GetCodeFixesResponse | undefined, documents: LspDocuments | undefined): Array<LSP.CodeAction> {
  if (!response?.body) {
    return [];
  }
  return response.body.map((fix: FishProtocol.CodeAction) => LSP.CodeAction.create(
    fix.description,
    {
      title: fix.description,
      command: Commands.APPLY_WORKSPACE_EDIT,
      arguments: [{ documentChanges: fix.changes.map(c => toTextDocumentEdit(c, documents)) }],
    },
    LSP.CodeActionKind.Refactor,
  ));
}

export function provideRefactors(response: FishProtocol.GetApplicableRefactorsResponse | undefined, args: FishProtocol.FileRangeRequestArgs, features: SupportedFeatures): LSP.CodeAction[] {
  if (!response?.body) {
    return [];
  }
  const actions: LSP.CodeAction[] = [];
  for (const info of response.body) {
    if (info.inlineable === false) {
      actions.push(asSelectRefactoring(info, args));
    } else {
      const relevantActions = features.codeActionDisabledSupport
        ? info.actions
        : info.actions.filter(action => !action.notApplicableReason);
      for (const action of relevantActions) {
        actions.push(asApplyRefactoring(action, info, args));
      }
    }
  }
  return actions;
}

export function asSelectRefactoring(info: FishProtocol.ApplicableRefactorInfo, args: FishProtocol.FileRangeRequestArgs): LSP.CodeAction {
  return LSP.CodeAction.create(
    info.description,
    LSP.Command.create(info.description, Commands.SELECT_REFACTORING, info, args),
    LSP.CodeActionKind.Refactor,
  );
}

export function asApplyRefactoring(action: FishProtocol.RefactorActionInfo, info: FishProtocol.ApplicableRefactorInfo, args: FishProtocol.FileRangeRequestArgs): LSP.CodeAction {
  const codeAction = LSP.CodeAction.create(action.description, asKind(info));
  if (action.notApplicableReason) {
    codeAction.disabled = { reason: action.notApplicableReason };
  } else {
    codeAction.command = LSP.Command.create(
      action.description,
      Commands.APPLY_REFACTORING,
      {
        ...args,
        refactor: info.name,
        action: action.name,
      },
    );
  }
  return codeAction;
}

function asKind(refactor: FishProtocol.RefactorActionInfo): LSP.CodeActionKind {
  if (refactor.name.startsWith('function_')) {
    return `${LSP.CodeActionKind.RefactorExtract}.function`;
  } else if (refactor.name.startsWith('constant_')) {
    return `${LSP.CodeActionKind.RefactorExtract}.constant`;
  } else if (refactor.name.startsWith('Move')) {
    return `${LSP.CodeActionKind.Refactor}.move`;
  }
  return LSP.CodeActionKind.Refactor;
}
