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
exports.HoverFromCompletion = exports.collectCompletionOptions = exports.forwardArgCommandCollect = exports.forwardSubCommandCollect = exports.documentationHoverCommandArg = exports.documentationHoverProvider = exports.enrichToPlainText = exports.enrichCommandArg = exports.enrichToCodeBlockMarkdown = exports.enrichToMarkdown = void 0;
const node_1 = require("vscode-languageserver-protocol/node");
const builtins_1 = require("./utils/builtins");
const exec_1 = require("./utils/exec");
const tree_sitter_1 = require("./utils/tree-sitter");
function enrichToMarkdown(doc) {
    return {
        kind: node_1.MarkupKind.Markdown,
        value: [
            doc,
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
        if (!cmdDocs) {
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
    for (const node of (0, tree_sitter_1.getChildNodes)(root)) {
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
/*export async function hoverForCommandArgument(node: SyntaxNode): Promise<Hover | null> {*/
/*const text = getNodeText(node) */
/*if (text.startsWith('-')) {*/
/*const parent = findParentCommand(node);*/
/*const hoverCompletion = new HoverFromCompletion(parent)*/
/*return await hoverCompletion.generate()*/
/*}*/
/*return null*/
/*}*/
function getFlagString(arr) {
    return '__' + arr[0] + '__' + ' ' + arr[1] + '\n';
}
class HoverFromCompletion {
    constructor(commandNode, currentNode) {
        var _a;
        this.commandString = "";
        this.entireCommandString = "";
        this.completions = [];
        this.oldOptions = false;
        this.flagsGiven = [];
        this.currentNode = currentNode;
        this.commandNode = commandNode;
        this.commandString = ((_a = commandNode.child(0)) === null || _a === void 0 ? void 0 : _a.text) || "";
        this.entireCommandString = commandNode.text || "";
        this.flagsGiven =
            this.entireCommandString
                .split(' ').slice(1)
                .filter(flag => flag.startsWith('-'))
                .map(flag => flag.split('=')[0]);
    }
    /**
     * set this.commandString for possible subcommands
     * handles a command such as:
     *        $ string match -ra '.*' -- "hello all people"
     */
    checkForSubCommands() {
        return __awaiter(this, void 0, void 0, function* () {
            const spaceCmps = yield (0, exec_1.execCompleteSpace)(this.commandString);
            if (spaceCmps.length == 0)
                return this.commandString;
            const cmdArr = this.commandNode.text.split(' ').slice(1);
            var i = 0;
            while (i < cmdArr.length) {
                const argStr = cmdArr[i].trim();
                if (!argStr.startsWith('-') && spaceCmps.includes(argStr)) {
                    this.commandString += ' ' + argStr.toString();
                }
                else if (argStr.includes('-')) {
                    break;
                }
                i++;
            }
            return this.commandString;
        });
    }
    isSubCommand() {
        const currentNodeText = this.currentNode.text;
        if (currentNodeText.startsWith('-') || currentNodeText.startsWith("'") || currentNodeText.startsWith('"')) {
            return false;
        }
        const cmdArr = this.commandString.split(' ');
        if (cmdArr.length > 1) {
            return cmdArr.includes(currentNodeText);
        }
        return false;
    }
    /**
     * @see man complete: styles --> long options
     * enables the ability to differentiate between
     * short flags chained together, or a command
     * that
     * a command option like:
     *            '-Wall' or             --> returns true
     *            find -name '.git'      --> returns true
     *
     *            ls -la                 --> returns false
     * @param {string[]} cmpFlags - [TODO:description]
     * @returns {boolean} true if old styles are valid
     *                    false if short flags can be chained
     */
    hasOldStyleFlags() {
        for (const cmpArr of this.completions) {
            if (cmpArr[0].startsWith('--')) {
                continue;
            }
            else if (cmpArr[0].startsWith('-') && cmpArr[0].length > 2) {
                return true;
            }
        }
        return false;
    }
    /**
    * handles splitting short options if the command has no
    * old style flags.
    * @see this.hasOldStyleFlags()
    */
    reparseFlags() {
        const shortFlagsHandled = [];
        for (const flag of this.flagsGiven) {
            if (flag.startsWith('--')) {
                shortFlagsHandled.push(flag);
            }
            else if (flag.startsWith('-') && flag.length > 2) {
                const splitShortFlags = flag.split('').slice(1).map(str => '-' + str);
                shortFlagsHandled.push(...splitShortFlags);
            }
        }
        return shortFlagsHandled;
    }
    buildCompletions() {
        return __awaiter(this, void 0, void 0, function* () {
            this.commandString = yield this.checkForSubCommands();
            const preBuiltCompletions = yield (0, exec_1.execCompleteCmdArgs)(this.commandString);
            for (const cmp of preBuiltCompletions) {
                this.completions.push(cmp.split('\t'));
            }
            return this.completions;
        });
    }
    findCompletion(flag) {
        for (const flagArr of this.completions) {
            if (flagArr[0] === flag) {
                return flagArr;
            }
        }
        return null;
    }
    checkForHoverDoc() {
        return __awaiter(this, void 0, void 0, function* () {
            const cmd = yield (0, exec_1.documentCommandDescription)(this.commandString);
            const cmdArr = cmd.trim().split(' ');
            const cmdStrLen = this.commandString.split(' ').length;
            const boldText = '__' + cmdArr.slice(0, cmdStrLen).join(' ') + '__';
            const otherText = ' ' + cmdArr.slice(cmdStrLen).join(' ');
            return boldText + otherText;
        });
    }
    generateForFlags() {
        return __awaiter(this, void 0, void 0, function* () {
            let text = "";
            this.completions = yield this.buildCompletions();
            this.oldOptions = this.hasOldStyleFlags();
            let cmd = yield this.checkForHoverDoc();
            if (!this.oldOptions) {
                this.flagsGiven = this.reparseFlags();
            }
            for (const flag of this.flagsGiven) {
                const found = this.findCompletion(flag);
                if (found) {
                    text += getFlagString(found);
                }
            }
            return {
                contents: enrichToMarkdown([
                    cmd,
                    '---',
                    text.trim()
                ].join('\n'))
            };
        });
    }
    generateForSubcommand() {
        return __awaiter(this, void 0, void 0, function* () {
            return yield documentationHoverProvider(this.commandString);
        });
    }
    generate() {
        return __awaiter(this, void 0, void 0, function* () {
            this.commandString = yield this.checkForSubCommands();
            if (this.isSubCommand()) {
                const output = yield documentationHoverProvider(this.commandString);
                //console.log(output)
                if (output)
                    return output;
            }
            else {
                return yield this.generateForFlags();
            }
            return;
        });
    }
}
exports.HoverFromCompletion = HoverFromCompletion;
//# sourceMappingURL=documentation.js.map