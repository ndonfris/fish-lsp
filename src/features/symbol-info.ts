import { SyntaxNode } from 'web-tree-sitter';
import { FishSymbol } from '../utils/symbol';
import { getPathProperties } from '../utils/translation';
import { isComment, isEmptyLine, isEscapeSequence, isFunctionDefinition, isInlineComment, isMatchingOption, isNewline, isOption, Option } from '../utils/node-types';
import { MarkdownDetail } from '../utils/detail-builder';
import { md } from '../utils/markdown-builder';
import { getPrecedingComments } from '../utils/tree-sitter';
import { SymbolKind } from 'vscode-languageserver';

export class SymbolInfoBuilder {
  constructor(public _symbol: FishSymbol) { }

  toString(): string {
    return this._symbol.name.toString();
  }

  public toDetail(): string {
    return this.toString();
  }

  public toMarkdown(): string {
    return this.toString();
  }
}

export class FunctionSymbolInfo extends SymbolInfoBuilder {
  public name: string = '';
  public path: string = '';
  public description: string = '';
  public isAutoLoad: boolean = false;
  public noScopeShadowing: boolean = false;
  public argumentNames: FishSymbol[] = [];
  public inheritVariable: FishSymbol[] = [];
  public onVariable: FishSymbol[] = [];
  public argparseOpts: FishSymbol[] = [];

  private constructor(symbol: FishSymbol) {
    super(symbol);
    this.name = symbol.name;
    this.path = getPathProperties(symbol.uri).shortenedPath;
    const args = symbol.parentNode?.childrenForFieldName('option');
    let mostRecentFlag: SyntaxNode | null = null;
    for (const arg of args) {
      if (isEscapeSequence(arg)) continue;

      /* handle special option -S/--no-scope-shadowing */
      if (isMatchingOption(arg, Option.create('-S', '--no-scope-shadowing'))) {
        this.noScopeShadowing = true;
        continue;
      }

      /* set the mostRecentFlag and skip to next loop */
      if (isOption(arg)) {
        mostRecentFlag = arg;
        continue;
      }

      /* check if the previous mostRecentFlag is a functionInfo modifier */
      if (mostRecentFlag && !isOption(arg)) {
        switch (true) {
          case isMatchingOption(mostRecentFlag, Option.create('-a', '--argument-names')):
            // const _symbol = symbol.findChildSymbolFromNode(arg);
            // if (!_symbol) break;
            // this.argumentNames.push(_symbol);

            this.argumentNames.push(symbol.findChildSymbolFromNode(arg)!);
            break;
          case isMatchingOption(mostRecentFlag, Option.create('-V', '--inherit-variable')):
            this.inheritVariable.push(symbol.findChildSymbolFromNode(arg)!);
            break;
          case isMatchingOption(mostRecentFlag, Option.create('-v', '--on-variable')):
            this.inheritVariable.push(symbol.findChildSymbolFromNode(arg)!);
            break;
          case isMatchingOption(mostRecentFlag, Option.create('-d', '--description')):
            this.description = arg.text;
            break;
          default:
            break;
        }
        continue;
      }
    }
    /** add argparse flags */
    symbol.children.forEach(child => {
      if (child.isArgparseFlag()) {
        this.argparseOpts.push(child);
      }
    });

    /* add autoloaded from the modifier */
    this.isAutoLoad = symbol.modifier === 'GLOBAL';
  }

  static create(symbol: FishSymbol): FunctionSymbolInfo {
    return new FunctionSymbolInfo(symbol);
  }

  private get argString(): string {
    const childArgv = this._symbol.children.find(arg => arg.name === 'argv');
    const hasArgv = childArgv ? childArgv?.getLocalReferenceNodes().length > 0 : false;
    const argvString = hasArgv
      ? this.argumentNames.length === 0 ? '$argv' : `$argv[${this.argumentNames.length + 1}..]`
      : '';

    const argumentNames = [
      ...this.argumentNames.map(arg => `$${arg.name}`),
      argvString,
    ].join(' ').trimEnd();
    return argumentNames;
  }

  toMarkdown(): string {
    const result = MarkdownDetail.create();
    result.addText(md.codeBlock('fish', `${this._symbol.name} ${this.argString}`.trimEnd()));
    result.addText(md.separator());
    result.addSection('Description', this.description.slice(1, this.description.length - 1));
    result.addSection('Autoloaded', boolOrEmpty(this.isAutoLoad));
    result.addSection('Path', getPathProperties(this.path).shortenedPath);
    result.addSection('Argument Names', ...this.argumentNames.map(s => s.name) ?? []);
    result.addSection('Inherit Variable', ...this.inheritVariable.map(s => s.name) ?? []);
    result.addSection('On Variable', ...this.onVariable.map(s => s.name) ?? []);
    result.addSection('No Scope Shadowing', boolOrEmpty(this.noScopeShadowing) ?? []);
    result.addSection('Flags', ...this.argparseOpts.map(s => s.name) ?? []);
    result.addText(md.separator());
    result.addText(md.codeBlock('fish', groupCommentsWithProperFormatting(this._symbol.parentNode, this._symbol.kind)));
    return result.build();
  }

  toDetail(): string {
    return this.toMarkdown();
  }

  toString(): string {
    return JSON.stringify({
      name: this.name,
      path: this.path,
      description: this.description,
      isAutoLoad: this.isAutoLoad,
      noScopeShadowing: this.noScopeShadowing,
      argumentNames: this.argumentNames.map(arg => arg.name),
      inheritVariable: this.inheritVariable.map(s => s.name),
      onVariable: this.onVariable.map(s => s.name),
      argparseOpts: this.argparseOpts.map(s => s.name),
      arguments: this.argumentNames.map(arg => arg.name),
    }, null, 2);
  }
}

export class VariableSymbolInfo extends SymbolInfoBuilder {
  public name: string = '';
  public path: string = '';
  public description: string = '';
  public scope: string = '';
  public isExported: boolean = false;
  public isPath: boolean = false;
  // public flags: VarOpt[] = [];

  private constructor(public _symbol: FishSymbol) {
    super(_symbol);
    this.name = _symbol.name;
    this.path = getPathProperties(_symbol.uri).shortenedPath;
    this.scope = _symbol.modifier;
    this.isExported = !!_symbol.parentNode.children.find(child => isMatchingOption(child, Option.create('-x', '--export')));
    this.isPath = !!_symbol.parentNode.children.find(child => isMatchingOption(child, { longOption: '--path' }));
  }

  static create(symbol: FishSymbol): VariableSymbolInfo {
    return new VariableSymbolInfo(symbol);
  }

  toMarkdown(): string {
    const result = MarkdownDetail.create();
    result.addText(md.codeBlock('fish', `$${this._symbol.name}`));
    result.addText(md.separator());
    result.addSection('Path', md.italic(this.path));
    result.addSection('Scope', this.scope);
    result.addSection('Exported', boolOrEmpty(this.isPath));
    result.addSection('Path', boolOrEmpty(this.isPath));
    result.addText(md.separator());
    result.addText(md.codeBlock('fish', groupCommentsWithProperFormatting(this._symbol.parentNode, this._symbol.kind)));
    return result.build();
  }

  toDetail() {
    return this.toMarkdown();
  }

  toString(): string {
    return JSON.stringify({
      name: this.name,
      path: this.path,
      scope: this.scope,
      isExported: this.isExported,
      isPath: this.isPath,
    }, null, 2);
  }
}

export type SymbolInfo = FunctionSymbolInfo | VariableSymbolInfo;

function boolOrEmpty(value: boolean): string {
  return value ? 'true' : '';
}

function removePrecedingBlockWhitespace(node: SyntaxNode): string {
  const lines = node.text.split('\n');
  const lastLine = node.lastChild?.startPosition.column || 0;
  return lines.map((line, index) => {
    if (index === 0) return line;
    return line.replace(' '.repeat(lastLine), '');
  }).join('\n').trimEnd();
}

function getPrecedingCommentString(node: SyntaxNode): string {
  const comments: string[] = [];
  let curr : SyntaxNode | null = node.previousNamedSibling;
  while (curr && !isEmptyLine(curr) && !isInlineComment(curr) && (isComment(curr) || isNewline(curr))) {
    comments.unshift(curr.text);
    curr = curr.previousSibling;
  }
  return comments.join('');
}

function groupCommentsWithProperFormatting(node: SyntaxNode, symbolKind: SymbolKind): string {
  if (symbolKind === SymbolKind.Function) {
    return [
      getPrecedingCommentString(node),
      removePrecedingBlockWhitespace(node),
    ].join('\n').trim();
  }
  if (symbolKind === SymbolKind.Variable && isFunctionDefinition(node)) {
    return removePrecedingBlockWhitespace(node);
  }
  return [
    getPrecedingCommentString(node),
    removePrecedingBlockWhitespace(node),
  ].join('\n').trim();
}

export type VarOpt = { short?: `-${string}`; long: `--${string}`; description: string; };
export const VarOpts: VarOpt[] = [
  { short: '-l', long: '--local', description: 'Sets a locally-scoped variable in this block.  It is erased when the block ends.  Outside of a block, this is the same as --function.' },
  { short: '-g', long: '--global', description: 'Sets a globally-scoped variable.  Global variables are available to all functions running in the same shell.  They can be modified or erased.' },
  { short: '-f', long: '--function', description: 'Sets a variable scoped to the executing function.  It is erased when the function ends.' },

  { short: '-U', long: '--Universal', description: 'Sets a universal variable.  The variable will be immediately available to all the user\'s fish instances on the machine, and will be persisted across restarts of the shell.' },
  { short: '-a', long: '--append', description: 'Appends VALUES to the current set of values for variable NAME.  Can be used with --prepend to both append and prepend at the same time.  This cannot be used when assigning to a variable slice.' },
  { short: '-p', long: '--prepend', description: 'Prepends VALUES to the current set of values for variable NAME.  This can be used with --append to both append and prepend at the same time.  This cannot be used when assigning to a variable slice.' },
  { short: '-e', long: '--erase', description: 'Causes the specified shell variables to be erased.  Supports erasing from multiple scopes at once.  Individual items in a variable at INDEX in brackets can be specified.' },
  { short: '-x', long: '--export', description: 'Causes the specified shell variable to be exported to child processes (making it an "environment variable").' },
  { short: '-u', long: '--unexport', description: 'Causes the specified shell variable to NOT be exported to child processes.' },

  { short: '-q', long: '--query', description: 'Test if the specified variable names are defined.  If an INDEX is provided, check for items at that slot.  Does not output anything, but the shell status is set to the number of variables specified that were not defined, up to a maximum of 255.  If no variable was given, it also returns 255.' },
  { long: '--path', description: 'Treat specified variable as a path variable, variable will be split on colons (:) and will be displayed joined by colons when quoted (echo "$PATH") or exported.' },
  { long: '--unpath', description: 'Treat specified variable as a non-path variable, variable will be displayed as a single string when quoted (echo "$PATH") or exported.' },

  { short: '-S', long: '--show', description: 'Shows information about the given variables.  If no variable names are given then all variables are shown in sorted order.  It shows the scopes the given variables are set in, along with the values in each and whether or not it is exported.  No other flags can be used with this option.' },
] as const;

export const OptionDesc = (node: SyntaxNode): VarOpt => {
  switch (true) {
    case isMatchingOption(node, Option.create('-l', '--local')):
      return { short: '-l', long: '--local', description: 'Sets a locally-scoped variable in this block.  It is erased when the block ends.  Outside of a block, this is the same as --function.' };
    case isMatchingOption(node, Option.create('-g', '--global')):
      return { short: '-g', long: '--global', description: 'Sets a globally-scoped variable.  Global variables are available to all functions running in the same shell.  They can be modified or erased.' };
    case isMatchingOption(node, Option.create('-f', '--function')):
      return { short: '-f', long: '--function', description: 'Sets a variable scoped to the executing function.  It is erased when the function ends.' };

    case isMatchingOption(node, Option.create('-U', '--Universal')):
      return { short: '-U', long: '--Universal', description: 'Sets a universal variable.  The variable will be immediately available to all the user\'s fish instances on the machine, and will be persisted across restarts of the shell.' };
    case isMatchingOption(node, Option.create('-a', '--append')):
      return { short: '-a', long: '--append', description: 'Appends VALUES to the current set of values for variable NAME.  Can be used with --prepend to both append and prepend at the same time.  This cannot be used when assigning to a variable slice.' };
    case isMatchingOption(node, Option.create('-p', '--prepend')):
      return { short: '-p', long: '--prepend', description: 'Prepends VALUES to the current set of values for variable NAME.  This can be used with --append to both append and prepend at the same time.  This cannot be used when assigning to a variable slice.' };
    case isMatchingOption(node, Option.create('-e', '--erase')):
      return { short: '-e', long: '--erase', description: 'Causes the specified shell variables to be erased.  Supports erasing from multiple scopes at once.  Individual items in a variable at INDEX in brackets can be specified.' };
    case isMatchingOption(node, Option.create('-x', '--export')):
      return { short: '-x', long: '--export', description: 'Causes the specified shell variable to be exported to child processes (making it an "environment variable").' };
    case isMatchingOption(node, Option.create('-u', '--unexport')):
      return { short: '-u', long: '--unexport', description: 'Causes the specified shell variable to NOT be exported to child processes.' };

    case isMatchingOption(node, Option.create('-q', '--query')):
      return { short: '-q', long: '--query', description: 'Test if the specified variable names are defined.  If an INDEX is provided, check for items at that slot.  Does not output anything, but the shell status is set to the number of variables specified that were not defined, up to a maximum of 255.  If no variable was given, it also returns 255.' };
    case isMatchingOption(node, { longOption: '--path' }):
      return { long: '--path', description: 'Treat specified variable as a path variable; variable will be split on colons (:) and will be displayed joined by colons when quoted (echo "$PATH") or exported.' };
    case isMatchingOption(node, { longOption: '--unpath' }):
      return { long: '--unpath', description: 'Treat specified variable as a non-path variable; variable will be displayed as a single string when quoted (echo "$PATH") or exported.' };

    case isMatchingOption(node, Option.create('-S', '--show')):
      return { short: '-S', long: '--show', description: 'Shows information about the given variables.  If no variable names are given then all variables are shown in sorted order.  It shows the scopes the given variables are set in, along with the values in each and whether or not it is exported.  No other flags can be used with this option.' };
    default:
      return {} as never;
  }
};