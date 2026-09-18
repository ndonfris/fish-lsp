import { analyzer } from '../src/analyze';
import { createTestServer, setLogger, TestServerHandle } from './helpers';
import TestWorkspace, { TestFile } from './test-workspace-utils';
import { documents } from '../src/document';
import * as LSP from 'vscode-languageserver';
import { chmodSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { getChildNodes } from '../src/utils/tree-sitter';
import { isCommandWithName } from '../src/utils/node-types';
import { createAliasInlineAction, createAliasSaveActionNewFile } from '../src/code-actions/alias-wrapper';
import { ExecFishFiles, execCommandDocs, execCompletions, execSubCommandCompletions } from '../src/utils/exec';

setLogger();

/**
 * Hover docs and the alias code actions hand names and text from the file to fish.
 * None of it may run as fish code: each `touch` below leaves a marker file if it does.
 */
describe('text from a document never runs as fish code', () => {
  let handle: TestServerHandle;
  const DIR = mkdtempSync(join(tmpdir(), 'fish-lsp-no-exec-'));
  const touch = (marker: string) => `touch ${join(DIR, marker)}`;
  /** a program a document could name, e.g. a script in a cloned repo */
  const BIN = mkdtempSync(join(tmpdir(), 'fish-lsp-no-exec-bin-'));
  const SCRIPT = join(BIN, 'script');
  writeFileSync(SCRIPT, `#!/bin/sh\n${touch('script')}\n`);
  chmodSync(SCRIPT, 0o755);
  const SRC = [
    `function "fn$(${touch('function-name')})"; end`, // 0
    `function fn2(${touch('function-name-2')}); end`, // 1
    `set -g "var$(${touch('variable-name')})" 1`, // 2
    `alias "al$(${touch('alias-name')})"=ls`, // 3
    `alias foo='end; ${touch('alias-body')}; function bar'`, // 4
    `alias baz=(${touch('alias-arg')})`, // 5
    'alias ll=\'ls -la\'', // 6
    'alias g git', // 7
    'alias ls=\'ls --color\'', // 8
    `function fn3(pwd>${join(DIR, 'function-name-3')}); end`, // 9 - no spaces: `wordAtPoint()` keeps it whole
    'alias --save sv=\'echo hi\'', // 10
    `a'; ${touch('flag-command-name')}; echo ' --flag`, // 11 - a command name that closes its quote
    `b'; ${touch('subcommand-command-name')}; echo ' sub --flag`, // 12
    `--use-help ${SCRIPT}`, // 13 - get-docs.fish used to run `$argv --help` for `--use-help`
    `--u ${SCRIPT}`, // 14 - `argparse` reads `--u` as `--use-help`
  ];

  const ws = TestWorkspace.create().addFiles(TestFile.config(SRC.join('\n') + '\n')).initialize();

  beforeAll(async () => {
    handle = await createTestServer();
    ws.workspace!.uris.all.forEach(uri => {
      const doc = documents.get(uri);
      if (doc) analyzer.analyze(doc);
    });
  });
  afterEach(() => {
    const ran = readdirSync(DIR);
    ran.forEach(marker => rmSync(join(DIR, marker)));
    expect(ran).toEqual([]);
  });
  afterAll(async () => {
    await handle.shutdown();
    rmSync(DIR, { recursive: true, force: true });
    rmSync(BIN, { recursive: true, force: true });
  });

  /** the columns of the name's quote, its first letters, its `$(` and its `(` */
  function nameColumns(line: string): number[] {
    const name = line.indexOf(' ', line.indexOf(' ') + 1) === -1 ? line.length : line.indexOf(' ') + 1;
    return [...new Set([name, name + 1, name + 2, line.indexOf('$('), line.indexOf('(')])]
      .filter(col => col >= 0 && col < line.length);
  }

  it.each([
    [0, 'function'],
    [1, 'function, with a bare `(cmd)`'],
    [2, 'variable'],
    [3, 'alias'],
    [9, 'function, with a `(cmd)` that has no spaces'],
  ])('hovering the name on line %i (%s)', async (line) => {
    const doc = ws.find('config.fish')!;
    for (const character of nameColumns(SRC[line]!)) {
      await handle.server.onHover({
        textDocument: { uri: doc.uri },
        position: { line, character },
      } as LSP.HoverParams);
    }
  });

  it.each([
    [11, 'a command name that closes its quote'],
    [12, 'a command name that closes its quote, before a subcommand'],
  ])('hovering the flag on line %i (%s)', async (line) => {
    const doc = ws.find('config.fish')!;
    await handle.server.onHover({
      textDocument: { uri: doc.uri },
      position: { line, character: SRC[line]!.indexOf('--flag') + 2 },
    } as LSP.HoverParams);
  });

  it.each([
    ['execCompletions', execCompletions],
    ['execSubCommandCompletions', execSubCommandCompletions],
  ])('%s() given text that closes its quote', async (_name, exec) => {
    await exec(`git'; ${touch('closes-quote')}; echo '`);
    await exec(`git \\'; ${touch('escaped-quote')}; echo '`);
    await exec(`git "$(${touch('command-substitution')})"`);
  });

  it.each([
    [13, '`--use-help`'],
    [14, '`--u`'],
  ])('hovering line %i, a command named %s and the program after it', async (line) => {
    const doc = ws.find('config.fish')!;
    const text = SRC[line]!;
    for (const character of [0, 2, text.indexOf(SCRIPT), text.length - 1]) {
      await handle.server.onHover({
        textDocument: { uri: doc.uri },
        position: { line, character },
      } as LSP.HoverParams);
    }
  });

  it('get-docs.fish never reads a name from a document as one of its options', async () => {
    await ExecFishFiles.getDocs('--use-help', SCRIPT);
    await ExecFishFiles.getDocs('--u', SCRIPT);
    await execCommandDocs(`--use-help ${SCRIPT}`);
    expect((await ExecFishFiles.getDocs('-h')).stdout).not.toContain('Usage: get-docs.fish');
  });

  function aliasNode(line: number) {
    const doc = ws.find('config.fish')!;
    const root = analyzer.getRootNode(doc.uri)!;
    return getChildNodes(root).find(node => isCommandWithName(node, 'alias') && node.startPosition.row === line)!;
  }

  it.each([
    [3, 'a `$(cmd)` in its name'],
    [4, 'a body that closes the function early'],
    [5, 'a `(cmd)` argument'],
  ])('alias code actions for line %i (%s)', async (line) => {
    const doc = ws.find('config.fish')!;
    const node = aliasNode(line);
    expect(node).toBeTruthy();
    await createAliasInlineAction(doc, node);
    await createAliasSaveActionNewFile(doc, node);
  });

  it.each([
    [6, 'function ll --wraps=\'ls -la\' --description \'alias ll=ls -la\'\n    ls -la $argv\nend'],
    [7, 'function g --wraps=git --description \'alias g git\'\n    git $argv\nend'],
    [8, 'function ls --description \'alias ls=ls --color\'\n    command ls --color $argv\nend'],
    [10, 'function sv --wraps=\'echo hi\' --description \'alias sv=echo hi\'\n    echo hi $argv\nend'],
    // the body closing the function early is written out as is, and not run
    [4, `function foo --wraps='end; ${touch('alias-body')}; function bar' --description 'alias foo=end; ${touch('alias-body')}; function bar'\nend\n${touch('alias-body')}\nfunction bar $argv\nend`],
  ])('the inline alias action on line %i still writes the function `alias` would define', async (line, expected) => {
    const doc = ws.find('config.fish')!;
    const action = await createAliasInlineAction(doc, aliasNode(line));
    const edit = action?.edit?.changes?.[doc.uri]?.[0];
    expect(edit?.newText.trim()).toBe(expected);
  });
});
