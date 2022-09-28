"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.collectCompletionOptions = exports.forwardArgCommandCollect = exports.forwardSubCommandCollect = exports.documentationHoverCommandArg = exports.documentationHoverProvider = exports.enrichToPlainText = exports.enrichCommandArg = exports.enrichToCodeBlockMarkdown = exports.enrichToMarkdown = void 0;
const node_1 = require("vscode-languageserver-protocol/node");
const builtins_1 = require("./utils/builtins");
const exec_1 = require("./utils/exec");
const tree_sitter_1 = require("./utils/tree-sitter");
function enrichToMarkdown(doc) {
    return {
        kind: node_1.MarkupKind.Markdown,
        value: [
            doc.trim(),
        ].join()
    };
}
exports.enrichToMarkdown = enrichToMarkdown;
function enrichToCodeBlockMarkdown(doc, filetype = 'fish') {
    return {
        kind: node_1.MarkupKind.Markdown,
        value: [
            '```' + filetype,
            doc.trim(),
            '```'
        ].join('\n')
    };
}
exports.enrichToCodeBlockMarkdown = enrichToCodeBlockMarkdown;
function enrichCommandArg(doc) {
    const docArr = doc.split('\t', 1);
    const arg = '__' + docArr[0].trim() + '__';
    const desc = '_' + docArr[1].trim() + '_';
    const enrichedDoc = [
        arg,
        desc
    ].join('  ');
    return enrichToMarkdown(enrichedDoc);
}
exports.enrichCommandArg = enrichCommandArg;
function enrichToPlainText(doc) {
    return {
        kind: node_1.MarkupKind.PlainText,
        value: doc.trim()
    };
}
exports.enrichToPlainText = enrichToPlainText;
function documentationHoverProvider(cmd) {
    return __awaiter(this, void 0, void 0, function* () {
        const cmdDocs = yield (0, exec_1.execCommandDocs)(cmd);
        const cmdType = yield (0, exec_1.execCommandType)(cmd);
        if (!cmdType || !cmdDocs) {
            return null;
        }
        else {
            return {
                contents: cmdType == 'command'
                    ? enrichToCodeBlockMarkdown(cmdDocs, 'man')
                    : enrichToCodeBlockMarkdown(cmdDocs, 'fish')
            };
        }
    });
}
exports.documentationHoverProvider = documentationHoverProvider;
function commandStringHelper(cmd) {
    const cmdArray = cmd.split(' ', 1);
    return cmdArray.length > 1
        ? '___' + cmdArray[0] + '___' + ' ' + cmdArray[1]
        : '___' + cmdArray[0] + '___';
}
function documentationHoverCommandArg(root, cmp) {
    let text = '';
    const argsArray = [...cmp.args.keys()];
    for (const node of (0, tree_sitter_1.getNodes)(root)) {
        const nodeText = (0, tree_sitter_1.getNodeText)(node);
        if (nodeText.startsWith('-') && argsArray.includes(nodeText)) {
            text += '\n' + '_' + nodeText + '_ ' + cmp.args.get(nodeText);
        }
    }
    const cmd = commandStringHelper(cmp.command.trim());
    return { contents: enrichToMarkdown([
            cmd,
            '---',
            text.trim()
        ].join('\n'))
    };
}
exports.documentationHoverCommandArg = documentationHoverCommandArg;
function forwardSubCommandCollect(rootNode) {
    var stringToComplete = [];
    for (const curr of rootNode.children) {
        if (curr.text.startsWith('-') && curr.text.startsWith('$')) {
            break;
        }
        else {
            stringToComplete.push(curr.text);
        }
    }
    return stringToComplete;
}
exports.forwardSubCommandCollect = forwardSubCommandCollect;
function forwardArgCommandCollect(rootNode) {
    var stringToComplete = [];
    const currentNode = rootNode.children;
    for (const curr of rootNode.children) {
        if (curr.text.startsWith('-') && curr.text.startsWith('$')) {
            stringToComplete.push(curr.text);
        }
        else {
            continue;
        }
    }
    return stringToComplete;
}
exports.forwardArgCommandCollect = forwardArgCommandCollect;
function collectCompletionOptions(rootNode) {
    var cmdText = [rootNode.children[0].text];
    if ((0, builtins_1.hasPossibleSubCommand)(cmdText[0])) {
        cmdText = forwardSubCommandCollect(rootNode);
    }
    // DIFF FLAG FORMATS 
    // consider the differnece between, find -name .git
    // and ls --long -l
    // do complete and check for each flagsToFind
    //
    //exec
    var flagsToFind = forwardArgCommandCollect(rootNode);
}
exports.collectCompletionOptions = collectCompletionOptions;
//# sourceMappingURL=documentation.js.map