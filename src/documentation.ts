import { dirname } from 'path';
import { SyntaxNode } from 'web-tree-sitter';
import { Hover, MarkupContent, MarkupKind } from 'vscode-languageserver';
import { execCommandDocs, execCommandType, execExpandBraceExpansion } from './utils/exec';
import { md } from './utils/markdown-builder';
import { Analyzer } from './analyze';
import { getExpandedSourcedFilenameNode } from './parsing/source';
import { isOption } from './utils/node-types';
import { LspDocument } from './document';
import { uriToPath } from './utils/translation';
import { findPrebuiltDoc } from './utils/snippets';
import { childrenWithGaps, fishLiteral, safeFishSource } from './utils/safe-fish-source';

export type markdownFiletypes = 'fish' | 'man';

export function enrichToMarkdown(doc: string): MarkupContent {
  return {
    kind: MarkupKind.Markdown,
    value: doc,
  };
}

export function enrichToCodeBlockMarkdown(doc: string, filetype: markdownFiletypes = 'fish'): MarkupContent {
  return enrichToMarkdown(md.codeBlock(filetype, doc.trim()));
}

export function enrichCommandWithFlags(command: string, description: string, flags: string[]): MarkupContent {
  const title = description ? `(${md.bold(command)}) ${description}` : md.bold(command);
  const flagLines = flags.map(line => line.split('\t'))
    .map(line => `${md.bold(line.at(0)!)} ${md.italic(line.slice(1).join(' '))}`);

  const result: string[] = [];
  result.push(title);
  if (flags.length > 0) {
    result.push(md.separator());
    result.push(flagLines.join(md.newline()));
  }

  return enrichToMarkdown(result.join(md.newline()));
}

export function handleSourceArgumentHover(analyzer: Analyzer, current: SyntaxNode, document?: LspDocument): Hover | null {
  // Get the base directory for resolving relative paths
  const sourceFilePath = document ? uriToPath(document.uri) : undefined;
  const baseDir = sourceFilePath ? dirname(sourceFilePath) : undefined;

  const sourceExpanded = getExpandedSourcedFilenameNode(current, baseDir, sourceFilePath);
  if (!sourceExpanded) return null;
  const sourceDoc = analyzer.getDocumentFromPath(sourceExpanded);
  if (!sourceDoc) {
    analyzer.analyzePath(sourceExpanded);
  }
  return {
    contents: enrichToMarkdown([
      `${md.boldItalic('SOURCE')} - ${md.italic('https://fishshell.com/docs/current/cmds/source.html')}`,
      md.separator(),
      `${md.codeBlock('fish', [
        'source ' + current.text,
        sourceExpanded && sourceExpanded !== current.text ? `# source ${sourceExpanded}` : undefined,
      ].filter(Boolean).join('\n'))}`,
      md.separator(),
      md.codeBlock('fish', sourceDoc!.getText()),
    ].join(md.newline())),
  };
}

/** `--opt={a,b}` → the source for just the value after the first `=`, `{'a','b'}` */
function optionValuePreviewSource(node: SyntaxNode): string | null {
  const parts = childrenWithGaps(node);
  const eq = parts.findIndex(part => (typeof part === 'string' ? part : part.text).includes('='));
  const part = parts[eq];
  if (!part) return null;
  // only split a `--opt=x` word or the `=` token itself, not e.g. a `"a=b"` string
  if (typeof part !== 'string' && part.isNamed && part.type !== 'word') return null;
  const text = typeof part === 'string' ? part : part.text;
  const value = text.slice(text.indexOf('=') + 1);
  return (value ? fishLiteral(value) : '') + parts.slice(eq + 1).map(safeFishSource).join('');
}

export async function handleBraceExpansionHover(current: SyntaxNode): Promise<Hover | null> {
  const source = isOption(current) && optionValuePreviewSource(current) || safeFishSource(current);
  const expanded = await execExpandBraceExpansion(source);
  if (expanded.trim() === '' || expanded.trim() === '1  |``|') {
    return null; // No expansion found, return null
  }
  const isBraceExpansion = current.type === 'brace_expansion'
    || current.children.some(child => child.type === 'brace_expansion');
  const headerLines = isBraceExpansion ? [
    `${md.boldItalic('BRACE EXPANSION')} - ${md.italic('https://fishshell.com/docs/current/language.html#brace-expansion')}`,
    md.separator(),
  ] : [];
  // a multiline word's `\`+newline continuation lines keep the file's indentation
  // (`z/{\⏎        1/a,\⏎        2/b}`), which drifts right once the word is shown
  // on its own, so cap it at 4 spaces. Tabs are left alone: fish keeps them as part
  // of a brace item (`z/{\⏎<TAB>1/a}` → `z/<TAB>1/a`), unlike spaces.
  const shownText = current.text.replace(
    /\\(\r?\n)( {5,})/g,
    (_, newline: string) => `\\${newline}    `,
  );
  return {
    contents: enrichToMarkdown([
      ...headerLines,
      md.codeBlock('txt', shownText),
      // the preview still quotes whatever the error left behind, but fish itself
      // would reject or split the word differently
      ...current.hasError ? [md.italic('has a syntax error: fish may not expand it like this')] : [],
      md.separator(),
      md.codeBlock('markdown', expanded),
    ].join(md.newline())),
  };
}

export function handleEndStdinHover(current: SyntaxNode): Hover {
  return {
    contents: enrichToMarkdown([
      `(${md.boldItalic('END STDIN TOKEN')}) ${md.inlineCode(current.text)}`,
      md.separator(),
      [
        // TODO: decide on best wording for this documentation
        `The ${md.inlineCode('--')} token is used to denote that the command should ${md.bold('stop reading')} from ${md.inlineCode('/dev/stdin')} for ${md.italic('switches')}, and use the remaining ${md.inlineCode('$argv')} as ${md.italic('positional arguments')}.`,
        // '',
        // 'Useful when a command accepts switches and arguments that start with a dash (-).',
        // '',
        // `The ${md.boldItalic(`first`)} ${md.inlineCode('--')} ${md.boldItalic('argument')} that is not an option-argument should be accepted as a ${md.bold('delimiter')} indicating the ${md.bold('end of options')}.`,
        // '',
        // `Any ${md.bold('following arguments')} should be treated as operands, even if they begin with the ${md.bold('-')} character.`,
        // '',
        // md.codeBlock('fish', [
        //   '# example pattern:',
        //   'utility_name [options] [--] [operands]'
        // ].join(md.newline())),
      ].join(md.newline()),
      md.separator(),
      md.codeBlock('fish', [
        '### EXAMPLES',
        '',
        '# 1. `argparse` considers `--help` as input and not an option (variable `_flag_help` is set)',
        'argparse h/help -- --help',
        '',
        '# 2. `markdown_list` is joined without treating the \'- .*\' as options',
        'set markdown_list (string join -- \\n \'- first\' \'- second\' \'- third\')',
        '',
        '# 3. `hasargs` checks if the arguments contains a -q option',
        'function hasargs',
        '    if contains -- -q $argv',
        '        echo \'$argv contains a -q option\'',
        '    end',
        'end',
      ].join('\n')),
    ].join(md.newline())),
  };
}

const buildDocUrl = (name: string) => `${md.formattedUrl(`https://fishshell.com/docs/current/cmds/${name}.html`)}`;
const buildDocTitle = (name: string) => `${md.bold(name.toUpperCase())} - ${buildDocUrl(name)}`;

export async function documentationHoverProvider(cmd: string): Promise<Hover | null> {
  const cmdDocs = await execCommandDocs(cmd);
  if (!cmdDocs) return null;

  const cmdType = await execCommandType(cmd);

  const docType = ['command', 'builtin'].includes(cmdType) ? 'man' : 'fish';
  let contents: string = md.codeBlock(docType, cmdDocs);
  let formattedCmd = cmd;

  // handle edge case inputs like `string SUBCMD`/`alias ...`/`export ...`
  if (cmd.startsWith('string')) formattedCmd = cmd.replace(' ', '-');
  if (formattedCmd.includes(' ')) formattedCmd = formattedCmd.slice(0, formattedCmd.indexOf(' '));
  if (findPrebuiltDoc(formattedCmd, 'command')) {
    contents = [
      buildDocTitle(formattedCmd),
      md.separator(),
      contents,
    ].join(md.newline());
  }

  return {
    contents,
  };
}
