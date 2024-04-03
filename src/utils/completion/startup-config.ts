import { FishCompletionItem, FishCompletionItemKind } from './types';

export type SetupItem = {
  command: string;
  detail: string;
  fishKind: FishCompletionItemKind;
  topLevel: boolean;
};

export const SetupItemsFromCommandConfig: SetupItem[] = [
  {
    command: "abbr --show | string split ' -- ' -m1 -f2 | string unescape",
    detail: 'Abbreviation',
    fishKind: FishCompletionItemKind.ABBR,
    topLevel: true,
  },
  {
    command: 'builtin --names',
    detail: 'Builtin',
    fishKind: FishCompletionItemKind.BUILTIN,
    topLevel: true,
  },
  {
    command: "alias | string collect | string unescape | string split ' ' -m1 -f2",
    detail: 'Alias',
    fishKind: FishCompletionItemKind.ALIAS,
    topLevel: true,
  },
  {
    command: 'functions --all --names | string collect',
    detail: 'Function',
    fishKind: FishCompletionItemKind.FUNCTION,
    topLevel: true,
  },
  {
    //command: "path filter -fx $PATH/* | path basename",
    //command: "bash -c 'compgen -c | sort -u | uniq'",
    //command: "path filter -fx $PATH/* | path sort -u | path basename",
    //command: "path sort --unique --key=basename $PATH/* | path basename",
    //command: "path filter -fx $PATH/* | path sort -u | path basename",
    command: 'complete -C \'\'',
    detail: 'Command',
    fishKind: FishCompletionItemKind.COMMAND,
    topLevel: true,
  },
  {
    command: 'set --names',
    detail: 'Variable',
    fishKind: FishCompletionItemKind.VARIABLE,
    topLevel: false,
  },
  {
    command: "functions --handlers | string match -vr '^Event \\w+'",
    detail: 'Event Handler',
    fishKind: FishCompletionItemKind.EVENT,
    topLevel: false,
  },
];
