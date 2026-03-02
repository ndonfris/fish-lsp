import {
  CompletionContext,
  CompletionItem,
  CompletionItemKind, MarkupContent,
  MarkupKind,
  Position, Range,
  SymbolKind,
  TextEdit,
} from 'vscode-languageserver';
import { FishSymbol } from '../../parsing/symbol';
import { md } from '../markdown-builder';

export const FishCompletionItemKind = {
  ABBR: 'abbr',
  BUILTIN: 'builtin',
  FUNCTION: 'function',
  VARIABLE: 'variable',
  EVENT: 'event',
  PIPE: 'pipe',
  ESC_CHARS: 'esc_chars',
  STATUS: 'status',
  WILDCARD: 'wildcard',
  COMMAND: 'command',
  ALIAS: 'alias',
  REGEX: 'regex',
  COMBINER: 'combiner',
  FORMAT_STR: 'format_str',
  STATEMENT: 'statement',
  ARGUMENT: 'argument',
  PATH: 'path',
  EMPTY: 'empty',
  SHEBANG: 'shebang',
  COMMENT: 'comment',
  DIAGNOSTIC: 'diagnostic',
} as const;
export type FishCompletionItemKind = typeof FishCompletionItemKind[keyof typeof FishCompletionItemKind];

export const toCompletionItemKind: Record<FishCompletionItemKind, CompletionItemKind> = {
  [FishCompletionItemKind.ABBR]: CompletionItemKind.Snippet,
  [FishCompletionItemKind.BUILTIN]: CompletionItemKind.Keyword,
  [FishCompletionItemKind.FUNCTION]: CompletionItemKind.Function,
  [FishCompletionItemKind.VARIABLE]: CompletionItemKind.Variable,
  [FishCompletionItemKind.EVENT]: CompletionItemKind.Event,
  [FishCompletionItemKind.PIPE]: CompletionItemKind.Operator,
  [FishCompletionItemKind.ESC_CHARS]: CompletionItemKind.Operator,
  [FishCompletionItemKind.STATUS]: CompletionItemKind.EnumMember,
  [FishCompletionItemKind.WILDCARD]: CompletionItemKind.Operator,
  [FishCompletionItemKind.COMMAND]: CompletionItemKind.Class,
  [FishCompletionItemKind.ALIAS]: CompletionItemKind.Constructor,
  [FishCompletionItemKind.REGEX]: CompletionItemKind.Operator,
  [FishCompletionItemKind.COMBINER]: CompletionItemKind.Keyword,
  [FishCompletionItemKind.FORMAT_STR]: CompletionItemKind.Operator,
  [FishCompletionItemKind.STATEMENT]: CompletionItemKind.Keyword,
  [FishCompletionItemKind.ARGUMENT]: CompletionItemKind.Property,
  [FishCompletionItemKind.PATH]: CompletionItemKind.File,
  [FishCompletionItemKind.EMPTY]: CompletionItemKind.Text,
  [FishCompletionItemKind.SHEBANG]: CompletionItemKind.File,
  [FishCompletionItemKind.COMMENT]: CompletionItemKind.Text,
  [FishCompletionItemKind.DIAGNOSTIC]: CompletionItemKind.Text,
};
export type FishCompletionData = {
  uri: string;
  line: string;
  word: string;
  position: Position;
  command?: string;
  context?: CompletionContext;
  fishKind?: FishCompletionItemKind;
  detail?: string;
  local?: boolean;
  useDocAsDetail?: boolean;
};

export interface FishCompletionItem extends CompletionItem {
  detail: string;
  //documentation: string;
  fishKind: FishCompletionItemKind;
  examples?: CompletionExample[];
  local: boolean;
  useDocAsDetail: boolean;
  data?: FishCompletionData;
  priority?: number;
  setKinds(kind: FishCompletionItemKind): FishCompletionItem;
  setLocal(): FishCompletionItem;
  setData(data: FishCompletionData): FishCompletionItem;
  setPriority(priority: number): FishCompletionItem;
}

export function getCompletionDocumentationValue(
  documentation: string | MarkupContent | undefined | null,
): string {
  if (typeof documentation === 'string') {
    return documentation;
  }
  if (documentation && typeof documentation.value === 'string') {
    return documentation.value;
  }
  return '';
}

export function normalizeCompletionMarkdownValue(value: string): string {
  if (!value) return value;
  return value
    .replace(/\r\n/g, '\n')
    .replace(/^[ \t]*___[ \t]*$/gm, '---')
    .replace(/[ \t]*\n[ \t]*---[ \t]*\n[ \t]*/g, '\n\n---\n\n');
}

export function toCompletionMarkdownDocumentation(
  documentation: string | MarkupContent | undefined | null,
): MarkupContent {
  const normalizedValue = normalizeCompletionMarkdownValue(
    getCompletionDocumentationValue(documentation),
  );
  return {
    kind: MarkupKind.Markdown,
    value: normalizedValue,
  };
}

export function normalizeCompletionItemDocumentation(item: FishCompletionItem): FishCompletionItem {
  const docValue = getCompletionDocumentationValue(item.documentation).trim();
  if (docValue.length > 0) {
    item.documentation = toCompletionMarkdownDocumentation(item.documentation);
  }
  return item;
}

export class FishCompletionItem implements FishCompletionItem {
  constructor(
    public label: string,
    public fishKind: FishCompletionItemKind,
    public detail: string,
    public documentation: string | MarkupContent,
    public examples?: CompletionExample[],
  ) {
    this.local = false;
    this.useDocAsDetail = false;
    //this.labelDetails = this.detail;
    this.setKinds(fishKind);
  }

  setKinds(kind: FishCompletionItemKind) {
    this.kind = toCompletionItemKind[kind];
    this.fishKind = kind;
    return this;
  }

  setLocal() {
    this.local = true;
    return this;
  }

  setUseDocAsDetail() {
    this.useDocAsDetail = true;
    return this;
  }

  setData(data: FishCompletionData) {
    this.data = {
      ...data,
      fishKind: this.fishKind,
      detail: this.detail,
      local: this.local,
      useDocAsDetail: this.useDocAsDetail,
    };
    const removeLength = data.word ? data.word.length : 1;
    this.textEdit = TextEdit.replace(
      Range.create({ line: data.position.line, character: data.position.character - removeLength }, data.position),
      this.insertText || this.label,
    );
    return this;
  }

  setPriority(priority: number) {
    this.priority = priority;
    return this;
  }
}

export class FishCommandCompletionItem extends FishCompletionItem {
  // constructor(label: string, fishKind: FishCompletionItemKind, detail: string, documentation: string) {
  //   super(label, fishKind, detail, documentation);
  // }
}

export class FishAbbrCompletionItem extends FishCommandCompletionItem {
  constructor(label: string, detail: string, documentation: string) {
    super(label, FishCompletionItemKind.ABBR, detail, documentation);
    const last = Math.max(documentation.lastIndexOf('#') + 1, documentation.length);
    this.insertText = documentation.slice(label.length + 1, last);
    this.commitCharacters = ['\t', ';', ' '];
  }
}

export class FishAliasCompletionItem extends FishCommandCompletionItem {
  constructor(label: string, detail: string, documentation: string) {
    super(label, FishCompletionItemKind.ALIAS, detail, documentation);
    this.documentation = documentation.slice(label.length + 1);
  }
}

export namespace FishCompletionItem {
  export function create(label: string, kind: FishCompletionItemKind, detail: string, documentation: string, examples?: CompletionExample[]) {
    switch (kind) {
      case FishCompletionItemKind.ABBR:
        return new FishAbbrCompletionItem(label, detail, documentation);
      case FishCompletionItemKind.ALIAS:
        return new FishAliasCompletionItem(label, detail, documentation);
      case FishCompletionItemKind.COMMAND:
      case FishCompletionItemKind.BUILTIN:
      case FishCompletionItemKind.FUNCTION:
      case FishCompletionItemKind.VARIABLE:
      case FishCompletionItemKind.EVENT:
        return new FishCommandCompletionItem(label, kind, detail, documentation);
      default:
        return new FishCompletionItem(label, kind, detail, documentation, examples);
    }
  }
  export function fromSymbol(symbol: FishSymbol) {
    switch (symbol.kind) {
      case SymbolKind.Function:
        return create(symbol.name, FishCompletionItemKind.FUNCTION, 'Function', symbol.detail).setLocal().setPriority(50);
      case SymbolKind.Variable:
        return create(symbol.name, FishCompletionItemKind.VARIABLE, 'Variable', symbol.detail).setLocal().setPriority(60);
      default:
        return create(symbol.name, FishCompletionItemKind.EMPTY, 'Empty', symbol.detail).setLocal().setPriority(70);
    }
  }

  export function createData(
    uri: string,
    line: string,
    word: string,
    position: Position,
    command?: string,
    context?: CompletionContext,
  ): FishCompletionData {
    return { uri, line, word, position, command, context };
  }
}

export interface CompletionExample {
  title: string;
  shellText: string;
}

export namespace CompletionExample {
  export function create(title: string, ...shellText: string[]): CompletionExample {
    const shellTextString: string = shellText.length > 1 ? shellText.join('\n') : shellText.at(0)!;
    return {
      title,
      shellText: shellTextString,
    };
  }

  export function toMarkedString(example: CompletionExample): string {
    return [
      md.separator(),
      '```fish',
      `# ${example.title}`,
      example.shellText,
      '```',
    ].join('\n');
  }
}
