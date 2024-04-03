import { CompletionItem, FormattingOptions } from 'vscode-languageserver';
import { Hover, MarkupContent, MarkupKind } from 'vscode-languageserver-protocol/node';
import { SyntaxNode } from 'web-tree-sitter';
import { hasPossibleSubCommand } from './utils/builtins';
import { execCommandDocs, execCommandType, CompletionArguments, execCompleteSpace, execCompleteCmdArgs, documentCommandDescription } from './utils/exec';
import { findParentCommand } from './utils/node-types';
import { getChildNodes, getNodeText } from './utils/tree-sitter';

//////// @TODO: clean up this file

export type markdownFiletypes = 'fish' | 'man';

export function enrichToMarkdown(doc: string): MarkupContent {
  return {
    kind: MarkupKind.Markdown,
    value: [
      doc,
    ].join(),
  };
}

export function enrichToCodeBlockMarkdown(doc: string, filetype:markdownFiletypes = 'fish'): MarkupContent {
  return {
    kind: MarkupKind.Markdown,
    value: [
      '```' + filetype,
      doc.trim(),
      '```',
    ].join('\n'),
  };
}

export function enrichWildcard(label: string, documentation: string, examples: [string, string][]): MarkupContent {
  const exampleStr: string[] = ['---'];
  for (const [cmd, desc] of examples) {
    exampleStr.push(`__${cmd}__ - ${desc}`);
  }
  return {
    kind: MarkupKind.Markdown,
    value: [
      `_${label}_ ${documentation}`,
      '---',
      exampleStr.join('\n'),
    ].join('\n'),
  };
}

export function enrichCommandArg(doc: string): MarkupContent {
  const [_first, ...after] = doc.split('\t');
  const first = _first?.trim() || '';
  const second = after?.join('\t').trim() || '';

  const arg = '__' + first + '__';
  const desc = '_' + second + '_';
  const enrichedDoc = [
    arg,
    desc,
  ].join('  ');
  return enrichToMarkdown(enrichedDoc);
}

export function enrichCommandWithFlags(command: string, flags: string[]): MarkupContent {
  const retString = [
    `___${command}___`,
    '___',
    flags.map(line => line.split('\t'))
      .map(line => `__${line[0]}__ _${line.slice(1).join(' ')}_`)
      .join('\n'),
  ].join('\n');
  return enrichToMarkdown(retString);
}

export function enrichToPlainText(doc: string): MarkupContent {
  return {
    kind: MarkupKind.PlainText,
    value: doc.trim(),
  };
}

export async function documentationHoverProvider(cmd: string) : Promise<Hover | null> {
  const cmdDocs = await execCommandDocs(cmd);
  const cmdType = await execCommandType(cmd);

  if (!cmdDocs) {
    return null;
  } else {
    return {
      contents: cmdType === 'command'
        ? enrichToCodeBlockMarkdown(cmdDocs, 'man')
        : enrichToCodeBlockMarkdown(cmdDocs, 'fish'),
    };
  }
}

export async function documentationHoverProviderForBuiltIns(cmd: string): Promise<Hover | null> {
  const cmdDocs: string = await execCommandDocs(cmd);
  if (!cmdDocs) {
    return null;
  }
  const splitDocs = cmdDocs.split('\n');
  const startIndex = splitDocs.findIndex((line: string) => line.trim() === 'NAME');
  return {
    contents: {
      kind: MarkupKind.Markdown,
      value: [
        `__${cmd.toUpperCase()}__ - _https://fishshell.com/docs/current/cmds/${cmd.trim()}.html_`,
        '___',
        '```man',
        splitDocs.slice(startIndex).join('\n'),
        '```',
      ].join('\n'),
    },
  };
}

function commandStringHelper(cmd: string) {
  const cmdArray = cmd.split(' ', 1);
  return cmdArray.length > 1
    ? '___' + cmdArray[0] + '___' + ' ' + cmdArray[1]
    : '___' + cmdArray[0] + '___';
}

export function documentationHoverCommandArg(root: SyntaxNode, cmp: CompletionArguments) : Hover {
  let text = '';
  const argsArray = [...cmp.args.keys()];
  for (const node of getChildNodes(root)) {
    const nodeText = getNodeText(node);
    if (nodeText.startsWith('-') && argsArray.includes(nodeText)) {
      text += '\n' + '_' + nodeText + '_ ' + cmp.args.get(nodeText);
    }
  }
  const cmd = commandStringHelper(cmp.command.trim());
  return { contents:
        enrichToMarkdown(
          [
            cmd,
            '---',
            text.trim(),
          ].join('\n'),
        ),
  };
}

export function forwardSubCommandCollect(rootNode: SyntaxNode): string[] {
  const stringToComplete : string[] = [];
  for (const curr of rootNode.children) {
    if (curr.text.startsWith('-') && curr.text.startsWith('$')) {
      break;
    } else {
      stringToComplete.push(curr.text);
    }
  }
  return stringToComplete;
}

export function forwardArgCommandCollect(rootNode: SyntaxNode) : string[] {
  const stringToComplete : string[] = [];
  const currentNode = rootNode.children;
  for (const curr of rootNode.children) {
    if (curr.text.startsWith('-') && curr.text.startsWith('$')) {
      stringToComplete.push(curr.text);
    } else {
      continue;
    }
  }
  return stringToComplete;
}

export function collectCompletionOptions(rootNode: SyntaxNode) {
  let cmdText = [rootNode.children[0]!.text];
  if (hasPossibleSubCommand(cmdText[0]!)) {
    cmdText = forwardSubCommandCollect(rootNode);
  }
  // DIFF FLAG FORMATS
  // consider the differnece between, find -name .git
  // and ls --long -l

  // do complete and check for each flagsToFind
  //
  //exec

  const flagsToFind = forwardArgCommandCollect(rootNode);
}

/*export async function hoverForCommandArgument(node: SyntaxNode): Promise<Hover | null> {*/
/*const text = getNodeText(node) */
/*if (text.startsWith('-')) {*/
/*const parent = findParentCommand(node);*/
/*const hoverCompletion = new HoverFromCompletion(parent)*/
/*return await hoverCompletion.generate()*/
/*}*/
/*return null*/
/*}*/

function getFlagString(arr: string[]): string {
  return '__' + arr[0] + '__' + ' ' + arr[1] + '\n';
}

export class HoverFromCompletion {
  private currentNode: SyntaxNode;

  private commandNode: SyntaxNode;
  private commandString: string = '';
  private entireCommandString: string = '';
  private completions: string[][] = [];
  private oldOptions: boolean = false;
  private flagsGiven: string[] = [];

  constructor(commandNode: SyntaxNode, currentNode: SyntaxNode) {
    this.currentNode = currentNode;
    this.commandNode = commandNode;
    this.commandString = commandNode.child(0)?.text || '';
    this.entireCommandString = commandNode.text || '';
    this.flagsGiven = this.entireCommandString
      .split(' ').slice(1)
      .filter(flag => flag.startsWith('-'))
      .map(flag => flag.split('=')[0]) as string[] || [];
  }

  /**
     * set this.commandString for possible subcommands
     * handles a command such as:
     *        $ string match -ra '.*' -- "hello all people"
     */
  private async checkForSubCommands() {
    const spaceCmps = await execCompleteSpace(this.commandString);
    if (spaceCmps.length === 0) {
      return this.commandString;
    }
    const cmdArr = this.commandNode.text.split(' ').slice(1);
    let i = 0;
    while (i < cmdArr.length) {
      const argStr = cmdArr[i]!.trim();
      if (!argStr.startsWith('-') && spaceCmps.includes(argStr)) {
        this.commandString += ' ' + argStr.toString();
      } else if (argStr.includes('-')) {
        break;
      }
      i++;
    }
    return this.commandString;
  }

  private isSubCommand() {
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
  private hasOldStyleFlags() {
    for (const cmpArr of this.completions) {
      if (cmpArr[0]?.startsWith('--')) {
        continue;
      } else if (cmpArr[0]?.startsWith('-') && cmpArr[0]?.length > 2) {
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
  private reparseFlags() {
    const shortFlagsHandled = [];
    for (const flag of this.flagsGiven) {
      if (flag.startsWith('--')) {
        shortFlagsHandled.push(flag);
      } else if (flag.startsWith('-') && flag.length > 2) {
        const splitShortFlags = flag.split('').slice(1).map(str => '-' + str);
        shortFlagsHandled.push(...splitShortFlags);
      }
    }
    return shortFlagsHandled;
  }

  public async buildCompletions() {
    this.commandString = await this.checkForSubCommands();
    const preBuiltCompletions = await execCompleteCmdArgs(this.commandString);
    for (const cmp of preBuiltCompletions) {
      this.completions.push(cmp.split('\t'));
    }
    return this.completions;
  }

  public findCompletion(flag: string) {
    for (const flagArr of this.completions) {
      if (flagArr[0] === flag) {
        return flagArr;
      }
    }
    return null;
  }

  private async checkForHoverDoc() {
    const cmd = await documentCommandDescription(this.commandString);
    const cmdArr = cmd.trim().split(' ');
    const cmdStrLen = this.commandString.split(' ').length;
    const boldText = '__' + cmdArr.slice(0, cmdStrLen).join(' ') + '__';
    const otherText = ' ' + cmdArr.slice(cmdStrLen).join(' ');
    return boldText + otherText;
  }

  public async generateForFlags(): Promise<Hover> {
    let text = '';
    this.completions = await this.buildCompletions();
    this.oldOptions = this.hasOldStyleFlags();
    const cmd = await this.checkForHoverDoc();
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
        text.trim(),
      ].join('\n')),
    };
  }

  public async generateForSubcommand() {
    return await documentationHoverProvider(this.commandString);
  }

  public async generate(): Promise<Hover | void> {
    this.commandString = await this.checkForSubCommands();
    if (this.isSubCommand()) {
      const output = await documentationHoverProvider(this.commandString);
      //console.log(output)
      if (output) {
        return output;
      }
    } else {
      return await this.generateForFlags();
    }
    return;
  }
}
