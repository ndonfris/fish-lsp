import {CodeAction, TextEdit, Range, CodeActionKind} from 'vscode-languageserver';
import {SyntaxNode} from 'web-tree-sitter';
import {pathToRelativeFilename, uriInUserFunctions} from './utils/translation';
import {getNodeAtRange, getRange} from './utils/tree-sitter';

export function createFunctionNameMatchesUri(uri: string, range: Range): CodeAction {
    const funcName = pathToRelativeFilename(uri)
    return CodeAction.create(
        'Rename function to match file name',
        { changes: { [uri]: [TextEdit.replace(range, funcName)] } },
        'quickfix.rename.function'
    )
}

export function createExtractPrivateFunction(uri: string, root: SyntaxNode, range: Range): CodeAction {
    const text = [
        'function _',
        getNodeAtRange(root, range)?.text || '',
        'end'
    ].join('\n')
    return CodeAction.create(
        'Refactor to private function',
        {
            changes: {
                [uri]: [
                    TextEdit.del(range),
                    TextEdit.insert({
                        line: getRange(root).end.line,
                        character: 0
                    }, text),
                ],
            },
        },
        "quickfix.extract.function"
    );
}                                                                                        

export function createExtractVariable(uri: string, curr: SyntaxNode, range: Range): CodeAction {
    const text = 'set    (' + curr.text! + ')'
    return CodeAction.create(
        'Refactor to variable',
        { changes: { [uri]: [TextEdit.replace(range, text)] } },
        'quickfix.extract.variable'
    )
}                                                                                        


