import { MarkupContent, SymbolKind } from 'vscode-languageserver';
import { FishCompletionItem, FishCompletionItemKind, CompletionExample, getCompletionDocumentationValue, toCompletionMarkdownDocumentation } from './types';
import { execCmd, execCommandDocs, ExecFishFiles } from '../exec';
import * as os from 'os';
import { md } from '../markdown-builder';
import { cachedDocumentation } from '../../server';
import { PrebuiltDocumentationMap } from '../snippets';

export async function getDocumentationResolver(item: FishCompletionItem): Promise<MarkupContent> {
  const docValue = getCompletionDocumentationValue(item.documentation);
  let docString: string = md.codeBlock('fish', docValue);
  if (!item.local) {
    switch (item.fishKind) {
      case FishCompletionItemKind.ABBR:
        docString = await getAbbrDocString(item.label) ?? docString;
        break;
      case FishCompletionItemKind.ALIAS:
        docString = await getAliasDocString(item.label, docValue || `alias ${item.label}`) ?? docString;
        break;
      case FishCompletionItemKind.COMBINER:
      case FishCompletionItemKind.STATEMENT:
      case FishCompletionItemKind.BUILTIN:
        docString = await getBuiltinDocString(item.label) ?? docString;
        break;
      case FishCompletionItemKind.COMMAND:
        docString = await getCommandDocString(item.label) ?? md.codeBlock('fish', item.label);
        break;
      case FishCompletionItemKind.FUNCTION:
        // await cache.find(item.label, );
        docString = await getFunctionDocString(item.label) ?? `(${md.bold('function')}) - ${md.inlineCode(item.label)}`;
        break;
      case FishCompletionItemKind.VARIABLE:
        docString = await getVariableDocString(item.label) ?? docString;
        break;
      case FishCompletionItemKind.EVENT:
        docString = await getEventHandlerDocString(item.documentation as string) ?? docString;
        break;
      case FishCompletionItemKind.COMMENT:
      case FishCompletionItemKind.SHEBANG:
      case FishCompletionItemKind.DIAGNOSTIC:
        docString = docValue;
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
        docString = await buildArgumentDocString(item);
        break;
      case FishCompletionItemKind.EMPTY:
      default:
        break;
    }
  }
  if (item.local) {
    return toCompletionMarkdownDocumentation(docValue) as MarkupContent;
  }
  return toCompletionMarkdownDocumentation({
    kind: 'markdown',
    value: docString,
  }) as MarkupContent;
}

/**
 * builds FunctionDocumentation string
 */
export async function getFunctionDocString(name: string): Promise<string | undefined> {
  function formatTitle(title: string[]) {
    const ensured = ensureMinLength(title, 5, '');
    const [path, autoloaded, line, _scope, description] = ensured;
    const header = [
      `(${md.bold('function')}) ${md.inlineCode(name)}`,
    ];
    if (description) {
      header.push(md.italic(description));
    }

    header.push(md.separator());
    if (path && path !== '-') {
      header.push(`* path: ${md.bold(path.replace(os.homedir(), '~'))}`);
    } else {
      header.push(`* path: ${md.bold('sourced')}`);
    }
    if (autoloaded) {
      header.push(`* autoloaded: ${autoloaded === 'autoloaded' ? md.italic('true') : md.italic('false')}`);
    }
    if (line) {
      header.push(`* line: ${md.italic(line)}`);
    }

    return header.join(md.newline());
  }

  const [title, body] = await Promise.all([
    execCmd(`functions -D -v ${name}`),
    execCmd(`functions --no-details ${name}`),
  ]);
  const value = cachedDocumentation?.find(name, SymbolKind.Function);
  if (value?.resolved && value.formattedDocs) {
    return value.formattedDocs.value;
  }
  // const globalFunc = analyzer.globalSymbols.find(name).filter(sym => sym.isFunction())
  // if (globalFunc.length > 0) {
  //   const sym = globalFunc.at(0);
  //   return sym?.toHover().contents.toString()
  // }
  return [
    formatTitle(title),
    md.separator(),
    md.codeBlock('fish', body.join('\n')),
  ].join('\n\n') || '';
}

export async function getStaticDocString(item: FishCompletionItem): Promise<string> {
  let result = md.codeBlock(
    'text',
    `${item.label} ${getCompletionDocumentationValue(item.documentation)}`,
  );
  item.examples?.forEach((example: CompletionExample) => {
    result += [
      '',
      md.separator(),
      '',
      md.codeBlock('fish', [
        `# ${example.title}`,
        example.shellText,
      ].join('\n')),
    ].join('\n');
  });
  return result;
}

async function buildArgumentDocString(item: FishCompletionItem): Promise<string> {
  const docValue = getCompletionDocumentationValue(item.documentation);
  if (!item.detail) {
    return md.codeBlock('fish', docValue);
  }
  return [
    md.codeBlock('fish', docValue),
    md.separator(),
    item.detail,
  ].join('\n\n');
}

export async function getAbbrDocString(name: string): Promise<string | undefined> {
  const items: string[] = await execCmd('abbr --show | string split \' -- \' -m1 -f2');
  function getAbbr(items: string[]): [string, string] {
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
    `(${md.bold('abbr')}) ${md.inlineCode(title)}`,
    md.separator(),
    md.codeBlock('fish', body.trimEnd()),
  ].join('\n\n') || '';
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
  const url = `https://fishshell.com/docs/current/cmds/${name.trim()}.html`;
  return [
    `${md.bold(name.toUpperCase())} - ${md.italic(url)}`,
    md.separator(),
    md.codeBlock('man', splitDocs.slice(startIndex).join('\n')),
  ].join('\n\n');
}

export async function getAliasDocString(label: string, line: string): Promise<string | undefined> {
  const content = line.includes('\t')
    ? line.split('\t')[1] || line
    : line;
  return [
    `(${md.bold('alias')}) ${md.inlineCode(label)}`,
    md.separator(),
    md.codeBlock('fish', content),
  ].join('\n\n');
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
      `(${md.bold('event')}) ${md.inlineCode(label || command)}`,
      md.separator(),
      `Event handler for \`${command}\``,
    ].join('\n\n');
  }
  return [
    `(${md.bold('event')}) - ${md.inlineCode(label || command)}`,
    md.separator(),
    doc,
  ].join('\n\n');
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
    md.separator(),
    middle.join('\n'),
    md.separator(),
    last,
  ].join('\n\n');
}

export async function getCommandDocString(name: string): Promise<string | undefined> {
  const cmdDocs: string = (await ExecFishFiles.getDocs(name)).stdout.toString();
  const title = `(${md.bold('command')}) ${md.inlineCode(name)}`;
  const isAlias = PrebuiltDocumentationMap.getByName(name).at(0);

  if (!cmdDocs) {
    return [
      title,
      md.separator(),
      `no manpage found for ${md.inlineCode(name)}`,
    ].join(md.newline());
  }

  if (isAlias && isAlias?.type === 'function' || cmdDocs.startsWith('#')) {
    return [
      title,
      md.separator(),
      isAlias?.description || md.codeBlock('fish', cmdDocs),
    ].join(md.newline());
  }

  const docsBody = md.codeBlock('man', cmdDocs);
  return [
    title,
    md.separator(),
    docsBody,
  ].join(md.newline());
}

function ensureMinLength<T>(arr: T[], minLength: number, fillValue?: T): T[] {
  while (arr.length < minLength) {
    arr.push(fillValue as T);
  }
  return arr;
}
