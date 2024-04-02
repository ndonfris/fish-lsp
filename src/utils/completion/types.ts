import {
  Command,
  CompletionContext,
  CompletionItem,
  CompletionItemKind,
  CompletionItemLabelDetails,
  InsertReplaceEdit,
  InsertTextFormat,
  InsertTextMode,
  MarkupContent,
  Position,
  RemoteConsole,
  Range,
  SymbolKind,
  TextEdit,
} from 'vscode-languageserver';
import { FishDocumentSymbol } from '../../document-symbol';

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
};
export type FishCompletionData = {
  uri: string;
  line: string;
  word: string;
  position: Position;
  context?: CompletionContext;
};

export interface FishCompletionItem extends CompletionItem {
  detail: string;
  //documentation: string;
  fishKind: FishCompletionItemKind;
  examples?: CompletionExample[];
  local: boolean;
  data?: FishCompletionData;
  setKinds(kind: FishCompletionItemKind): FishCompletionItem;
  setLocal(): FishCompletionItem;
  setData(data: FishCompletionData): FishCompletionItem;
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

  setData(data: FishCompletionData) {
    this.data = data;
    const removeLength = data.word ? data.word.length : 1;
    this.textEdit = TextEdit.replace(
      Range.create({ line: data.position.line, character: data.position.character - removeLength }, data.position),
      this.insertText || this.label,
    );
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
  export function fromSymbol(symbol: FishDocumentSymbol) {
    switch (symbol.kind) {
      case SymbolKind.Function:
        return create(symbol.name, FishCompletionItemKind.FUNCTION, 'Function', symbol.detail).setLocal();
      case SymbolKind.Variable:
        return create(symbol.name, FishCompletionItemKind.VARIABLE, 'Variable', symbol.detail).setLocal();
      default:
        return create(symbol.name, FishCompletionItemKind.EMPTY, 'Empty', symbol.detail).setLocal();
    }
  }

  export function createData(
    uri: string,
    line: string,
    word: string,
    position: Position,
    context?: CompletionContext,
  ): FishCompletionData {
    return { uri, line, word, position, context };
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
      '___',
      '```fish',
      `# ${example.title}`,
      example.shellText,
      '```',
    ].join('\n');
  }
}
