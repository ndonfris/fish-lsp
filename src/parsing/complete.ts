
import { SyntaxNode } from 'web-tree-sitter';
import { isCommandWithName, isProgram } from '../utils/node-types';
import { findOptions, Option, OptionValueMatch } from './options';
import { LspDocument } from '../document';
import { getChildNodes, getRange } from '../utils/tree-sitter';
import { FishSymbol } from './symbol';
import { pathToRelativeFunctionName, uriToPath } from '../utils/translation';
import { Location } from 'vscode-languageserver';

export const CompleteOptions = [
  Option.create('-c', '--command').withValue(),
  Option.create('-p', '--path'),
  Option.create('-e', '--erase'),
  Option.create('-s', '--short-option').withValue(),
  Option.create('-l', '--long-option').withValue(),
  Option.create('-o', '--old-option').withValue(),
  Option.create('-a', '--arguments').withValue(),
  Option.create('-k', '--keep-order'),
  Option.create('-f', '--no-files'),
  Option.create('-F', '--force-files'),
  Option.create('-r', '--require-parameter'),
  Option.create('-x', '--exclusive'),
  Option.create('-d', '--description').withValue(),
  Option.create('-w', '--wraps').withValue(),
  Option.create('-n', '--condition').withValue(),
  Option.create('-C', '--do-complete').withValue(),
  Option.long('--escape').withValue(),
  Option.create('-h', '--help'),
];

export type CompletionOptionKeys = 'command' | 'short' | 'long' | 'old' | 'description' | 'condition' | 'arguments';
export const CompletionOptionMap = {
  command: CompleteOptions.find(n => n.equalsRawOption('-c', '--command'))!,
  short: CompleteOptions.find(n => n.equalsRawOption('-s', '--short-option'))!,
  long: CompleteOptions.find(n => n.equalsRawOption('-l', '--long-option'))!,
  old: CompleteOptions.find(n => n.equalsRawOption('-o', '--old-option'))!,
  description: CompleteOptions.find(n => n.equalsRawOption('-d', '--description'))!,
  condition: CompleteOptions.find(n => n.equalsRawOption('-n', '--condition'))!,
  arguments: CompleteOptions.find(n => n.equalsRawOption('-a', '--arguments'))!,
};

export function getFocusedCompletionOptions(opts: OptionValueMatch[]) {
  const focusedOptions: Record<CompletionOptionKeys, OptionValueMatch[]> = {} as Record<CompletionOptionKeys, OptionValueMatch[]>;
  Object.keys(CompletionOptionMap).forEach(key => {
    const option = CompletionOptionMap[key as CompletionOptionKeys];
    opts.forEach((item) => {
      if (item.option.equalsOption(option)) {
        const value = focusedOptions[key as CompletionOptionKeys] || [];
        value.push(item);
        focusedOptions[key as CompletionOptionKeys] = value;
      }
    });
  });
  return focusedOptions;
}

export const CompletionSymbolFlags: Record<'short' | 'long' | 'old', OptionValueMatch[]> = {
  ['short']: [] as OptionValueMatch[],
  ['long']: [] as OptionValueMatch[],
  ['old']: [] as OptionValueMatch[],
};

export function isCompletionDefinition(node: SyntaxNode) {
  return isCommandWithName(node, 'complete');
}

function getCompletionSymbol(document: LspDocument, node: SyntaxNode): CompletionSymbol | null {
  if (!isCompletionDefinition(node)) {
    return null;
  }

  const searchNodes = node.childrenForFieldName('argument');
  const options = findOptions(searchNodes, CompleteOptions);

  const focused = getFocusedCompletionOptions(options.found);
  const flags: typeof CompletionSymbolFlags = {
    short: focused.short,
    long: focused.long,
    old: focused.old,
  };
  const command = focused.command.pop();
  const args = focused.arguments?.pop();
  const description = focused.description?.pop();
  const condition = focused.condition?.pop();

  return CompletionSymbol.create({
    flags,
    command: command?.value,
    description,
    argumentNames: args,
    condition,
    ...options,
    document,
  });
}

export function processCompletion(document: LspDocument, node: SyntaxNode) {
  const result: CompletionSymbol[] = [];
  for (const child of getChildNodes(node)) {
    if (isCompletionDefinition(node)) {
      const newSymbol = getCompletionSymbol(document, child);
      if (newSymbol) result.push(newSymbol);
    }
  }
  return result;
}

export interface CompletionSymbolOptions {
  flags: typeof CompletionSymbolFlags;
  command?: SyntaxNode | undefined;
  description?: OptionValueMatch | undefined;
  argumentNames?: OptionValueMatch | undefined;
  condition?: OptionValueMatch | undefined;
  remaining: SyntaxNode[];
  found: OptionValueMatch[];
  unused: Option[];
  document: LspDocument;
}

export class CompletionSymbol {
  public flags: typeof CompletionSymbolFlags = {
    short: [] as OptionValueMatch[],
    long: [] as OptionValueMatch[],
    old: [] as OptionValueMatch[],
  } as typeof CompletionSymbolFlags;
  public command: string | undefined = undefined;
  public description: OptionValueMatch | undefined = undefined;
  public argumentNames: OptionValueMatch | undefined = undefined;
  public condition: OptionValueMatch | undefined = undefined;
  public remaining: SyntaxNode[] = [];
  public found: OptionValueMatch[] = [];
  public unused: Option[] = [];
  public document: LspDocument;

  static create(opts: CompletionSymbolOptions) {
    return new this(opts);
  }

  constructor(opts: CompletionSymbolOptions) {
    this.flags = opts.flags;
    this.command = opts.command?.text || opts.document.getAutoLoadName();
    this.description = opts?.description;
    this.remaining = opts.remaining || [];
    this.found = opts.found || [];
    this.unused = opts.unused || [];
    this.document = opts.document;
  }

  public getFlags() {
    return {
      short: this.flags.short || [],
      long: this.flags.long || [],
      old: this.flags.old || [],
    };
  }

  getShortOptions() {
    return this.flags.short?.map(item => item.option) || [];
  }

  getLongOptions() {
    return this.flags.long?.map(item => item.option) || [];
  }

  getOldOptions() {
    return this.flags.old?.map(item => item.option) || [];
  }

  hasShortOptions() {
    return this.getShortOptions().length > 0;
  }

  hasLongOptions() {
    return this.getLongOptions().length > 0;
  }

  hasOldOptions() {
    return this.getOldOptions().length > 0;
  }

  getCommand() {
    return this.command;
  }

  getDescription() {
    return this.description?.value;
  }

  getCondition() {
    return this.condition?.value;
  }

  equals(option: Option) {
    return this.found.some(item => option.equals(item.value));
  }

  equalsFishSymbol(symbol: FishSymbol) {
    const { scopeNode, uri } = symbol;
    let commandName = scopeNode.firstNamedChild?.text || '';
    if (isProgram(scopeNode)) {
      commandName = pathToRelativeFunctionName(uriToPath(uri));
    }
    const symbolName = symbol.argparseFlagName;
    return commandName === this.command
      && this.found.some(item => item.value.text === symbolName);
  }

  toLocation(symbol: FishSymbol): Location {
    const text = this.found.find(opt => {
      return opt.value.text === symbol.argparseFlagName;
    })!;
    return Location.create(this.document.uri, getRange(text?.value));
  }
}
