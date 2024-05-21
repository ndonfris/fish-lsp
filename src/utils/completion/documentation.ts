import { MarkupContent } from 'vscode-languageserver';
import { FishCompletionItem, FishCompletionItemKind, CompletionExample } from './types';
import { execCmd, execCommandDocs } from '../exec';
import { getFlagDocumentationString } from '../flag-documentation';

export async function getDocumentationResolver(item: FishCompletionItem): Promise<MarkupContent> {
  let docString: string = ['```fish', item.documentation.toString(), '```'].join('\n');
  if (!item.local) {
    switch (item.fishKind) {
      case FishCompletionItemKind.ABBR:
        docString = await getAbbrDocString(item.label) ?? docString;
        break;
      case FishCompletionItemKind.ALIAS:
        docString = await getAliasDocString(item.label, item.documentation.toString() || `alias ${item.label}`) ?? docString;
        break;
      case FishCompletionItemKind.COMBINER:
      case FishCompletionItemKind.STATEMENT:
      case FishCompletionItemKind.BUILTIN:
        docString = await getBuiltinDocString(item.label) ?? docString;
        break;
      case FishCompletionItemKind.COMMAND:
        docString = await getCommandDocString(item.label) ?? docString;
        break;
      case FishCompletionItemKind.FUNCTION:
        docString = await getFunctionDocString(item.label) ?? docString;
        break;
      case FishCompletionItemKind.VARIABLE:
        docString = await getVariableDocString(item.label) ?? docString;
        break;
      case FishCompletionItemKind.EVENT:
        docString = await getEventHandlerDocString(item.documentation as string) ?? docString;
        break;
      case FishCompletionItemKind.STATUS:
      case FishCompletionItemKind.WILDCARD:
      case FishCompletionItemKind.REGEX:
      case FishCompletionItemKind.FORMAT_STR:
      case FishCompletionItemKind.ESC_CHARS:
      case FishCompletionItemKind.PIPE:
        docString ??= await getStaticDocString(item as FishCompletionItem);
        break;
      case FishCompletionItemKind.ARGUMENT:
        docString ??= await getFlagDocumentationString(item.documentation.toString().trimStart());
        break;
      case FishCompletionItemKind.EMPTY:
      default:
        break;
    }
  }
  return {
    kind: 'markdown',
    value: docString,
  } as MarkupContent;
}

/**
 * builds FunctionDocumentaiton string
 */
export async function getFunctionDocString(name: string): Promise<string | undefined> {
  function formatTitle(title: string[]) {
    const ensured = ensureMinLength(title, 5, '');
    const [path, autoloaded, line, scope, description] = ensured;

    return [
      `__\`${path}\`__`,
      `- autoloaded: ${autoloaded === 'autoloaded' ? '_true_' : '_false_'}`,
      `- line: _${line}_`,
      `- scope: _${scope}_`,
      `${description}`,
    ].map((str) => str.trim()).filter(l => l.trim().length).join('\n');
  }
  const [title, body] = await Promise.all([
    execCmd(`functions -D -v ${name}`),
    execCmd(`functions --no-details ${name}`),
  ]);
  return [
    formatTitle(title),
    '___',
    '```fish',
    body.join('\n'),
    '```',
  ].join('\n') || '';
}

export async function getStaticDocString(item: FishCompletionItem): Promise<string> {
  let result = [
    '```text',
    `${item.label}  -  ${item.documentation}`,
    '```',
  ].join('\n');
  item.examples?.forEach((example: CompletionExample) => {
    result += [
      '___',
      '```fish',
      `# ${example.title}`,
      example.shellText,
      '```',
    ].join('\n');
  });
  return result;
}

export async function getAbbrDocString(name: string): Promise<string | undefined> {
  const items: string[] = await execCmd('abbr --show | string split \' -- \' -m1 -f2');
  function getAbbr(items: string[]): [ string, string ] {
    const start: string = `${name} `;
    for (const item of items) {
      if (item.startsWith(start)) {
        return [start.trimEnd(), item.slice(start.length)];
      }
    }
    return ['', ''];
  }
  const [title, body] = getAbbr(items);
  return [
    `Abbreviation: \`${title}\``,
    '___',
    '```fish',
    body.trimEnd(),
    '```',
  ].join('\n') || '';
}
/**
 * builds MarkupString for builtin documentation
 */
export async function getBuiltinDocString(name: string): Promise<string | undefined> {
  const cmdDocs: string = await execCommandDocs(name);
  if (!cmdDocs) {
    return undefined;
  }
  const splitDocs = cmdDocs.split('\n');
  const startIndex = splitDocs.findIndex((line: string) => line.trim() === 'NAME');
  return [
    `__${name.toUpperCase()}__ - _https://fishshell.com/docs/current/cmds/${name.trim()}.html_`,
    '___',
    '```man',
    splitDocs.slice(startIndex).join('\n'),
    '```',
  ].join('\n');
}

export async function getAliasDocString(label: string, line: string): Promise<string | undefined> {
  return [
    `Alias: _${label}_`,
    '___',
    '```fish',
    line.split('\t')[1],
    '```',
  ].join('\n');
}

/**
 * builds MarkupString for event handler documentation
 */
export async function getEventHandlerDocString(documentation: string): Promise<string> {
  const [label, ...commandArr] = documentation.split(/\s/, 2);
  const command = commandArr.join(' ');
  const doc = await getFunctionDocString(command);
  if (!doc) {
    return [
      `Event: \`${label}\``,
      '___',
      `Event handler for \`${command}\``,
    ].join('\n');
  }
  return [
    `Event: \`${label}\``,
    '___',
    doc,
  ].join('\n');
}

/**
 * builds MarkupString for global variable documentation
 */
export async function getVariableDocString(name: string): Promise<string | undefined> {
  const vName = name.startsWith('$') ? name.slice(name.lastIndexOf('$')) : name;
  const out = await execCmd(`set --show --long ${vName}`);
  const { first, middle, last } = out.reduce((acc, curr, idx, arr) => {
    if (idx === 0) {
      acc.first = curr;
    } else if (idx === arr.length - 1) {
      acc.last = curr;
    } else {
      acc.middle.push(curr);
    }
    return acc;
  }, { first: '', middle: [] as string[], last: '' });
  return [
    first,
    '___',
    middle.join('\n'),
    '___',
    last,
  ].join('\n');
}

export async function getCommandDocString(name: string): Promise<string | undefined> {
  const cmdDocs: string = await execCommandDocs(name);
  if (!cmdDocs) {
    return undefined;
  }
  const splitDocs = cmdDocs.split('\n');
  const startIndex = splitDocs.findIndex((line: string) => line.trim() === 'NAME');
  return [
    '```man',
    splitDocs.slice(startIndex).join('\n'),
    '```',
  ].join('\n');
}

function ensureMinLength<T>(arr: T[], minLength: number, fillValue?: T): T[] {
  while (arr.length < minLength) {
    arr.push(fillValue as T);
  }
  return arr;
}
