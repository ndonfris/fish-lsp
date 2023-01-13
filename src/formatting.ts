import {SyntaxNode} from 'web-tree-sitter';
import {getChildNodes, getNodeText, getRange} from './utils/tree-sitter';
import {FishFormattingOptions} from './configManager';
import {isSwitchStatement} from './utils/node-types';

export function applyFormatterSettings(root: SyntaxNode, options: FishFormattingOptions) {
    let formattedText = root.text;
    let result = formattedText;
    const tabStr = ' '.repeat(options.tabSize || 4);
    result = formattedText.toString().replace(/ {4}/g, tabStr);
    if (!options.insertSpaces) {
        result = result.replace(new RegExp(tabStr, 'g'), '\t');
    }
    if (options.trimTrailingWhitespace) {
        result = result.split('\n').map(line => line.trimEnd()).join('\n');
    }
    if (options.trimFinalNewlines) {
        result = result.trimEnd()
    }
    if (options.insertFinalNewline) {
        result = result.trimEnd() + '\r\n'
    }
    if (options.removeLeadingSwitchCaseWhitespace) {
        const switches = getChildNodes(root).filter(n => isSwitchStatement(n))
        for (const scope of switches) {
            const range = getRange(scope)
            const startLine = range.start.line + 1
            const endLine = range.end.line - 1 
            const lines = formattedText.split('\n')
            formattedText = [
                ...lines.slice(0, startLine),
                ...lines.slice(startLine, endLine).map(line => line.replace(new RegExp(tabStr, ''), '')),
                ...lines.slice(endLine)
            ].join('\n')
        }
    }
    return result;
}

