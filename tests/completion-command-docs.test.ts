import { CompletionParams, MarkupContent, MarkupKind } from 'vscode-languageserver';
import { Analyzer, analyzer } from '../src/analyze';
import { initializeParser } from '../src/parser';
import { setupProcessEnvExecFile } from '../src/utils/process-env';
import { createFakeLspDocument, createMockConnection, setupStartupMock } from './helpers';

setupStartupMock();

import FishServer from '../src/server';
import { md } from '../src/utils/markdown-builder';
import { logger } from '../src/logger';

describe('Command completion documentation', () => {
  let server: FishServer;

  beforeAll(async () => {
    await setupProcessEnvExecFile();
    await initializeParser();
    await Analyzer.initialize();

    const mockConnection = createMockConnection();
    const mockInitializeParams = {
      processId: 1234,
      rootUri: 'file:///tmp',
      rootPath: '/tmp',
      capabilities: {
        workspace: {
          workspaceFolders: true,
        },
        textDocument: {
          completion: {
            completionItem: {
              snippetSupport: true,
            },
          },
        },
      },
      workspaceFolders: [],
    };

    const result = await FishServer.create(mockConnection, mockInitializeParams as any);
    server = result.server;
    server.backgroundAnalysisComplete = true;
  });

  // it('includes man markdown in onCompletion docs for foo2ddst', async () => {
  //   const content = 'foo2ddst';
  //   const doc = createFakeLspDocument('/tmp/foo.fish', content);
  //   analyzer.analyze(doc);
  //
  //   const params: CompletionParams = {
  //     textDocument: { uri: doc.uri },
  //     position: { line: 0, character: content.length },
  //   };
  //
  //   const result = await server.onCompletion(params);
  //   const item = result.items.find(i => i.label === 'foo2ddst');
  //   const resolvedItem = await server.onCompletionResolve(item!);
  //
  //   expect(resolvedItem).toBeDefined();
  //   expect(resolvedItem?.kind).toBe(7);
  //   expect(resolvedItem?.documentation).toBeDefined();
  //   const docs = item?.documentation as MarkupContent;
  //   expect(docs.kind).toBe(MarkupKind.Markdown);
  //   expect(docs.value).toContain('```man');
  //   expect(docs.value).toContain('foo2ddst -');
  // });

  it('includes man markdown in onCompletion docs for `bash`', async () => {
    const content = 'bash';
    const doc = createFakeLspDocument('/tmp/foo.fish', content);
    analyzer.analyze(doc);

    const params: CompletionParams = {
      textDocument: { uri: doc.uri },
      position: { line: 0, character: content.length },
    };

    const result = await server.onCompletion(params);
    const item = result.items.find(i => i.label === 'bash');
    const resolvedItem = await server.onCompletionResolve(item!);

    expect(resolvedItem).toBeDefined();
    expect(resolvedItem?.kind).toBe(7);
    expect(resolvedItem?.documentation).toBeDefined();
    expect((resolvedItem?.documentation as MarkupContent).value).toContain(`(${md.bold('command')}) ${md.inlineCode('bash')}`);
  });

  it('includes local function onCompletionResolve', async () => {
    const content = [
      'function my_func',
      '    echo "my_func"',
      'end',
      'my_func',
    ].join('\n');

    const doc = createFakeLspDocument('/tmp/foo.fish', content);
    analyzer.analyze(doc);

    const params: CompletionParams = {
      textDocument: { uri: doc.uri },
      position: { line: 3, character: 7 },
    };

    const result = await server.onCompletion(params);
    const item = result.items.find(i => i.label === 'my_func');
    const resolvedItem = await server.onCompletionResolve(item!);
    // logger.log({ resolvedItem, })

    expect(resolvedItem).toBeDefined();
    expect(resolvedItem?.kind).toBe(3);
    expect(resolvedItem?.documentation).toBeDefined();
    expect((resolvedItem?.documentation as MarkupContent).value).toContain(`(${md.bold('function')}) ${md.inlineCode('my_func')}`);
  });

  it('includes alias onCompletionResolve', async () => {
    const content = ['alias ll="ls -l"', ''].join('\n');
    const doc = createFakeLspDocument('/tmp/foo.fish', content);
    analyzer.analyze(doc);

    const params: CompletionParams = {
      textDocument: { uri: doc.uri },
      position: { line: 1, character: 0 },
    };

    const result = await server.onCompletion(params);
    const item = result.items.find(i => i.label === 'll');
    const resolvedItem = await server.onCompletionResolve(item!);
    // logger.log({ resolvedItem, })

    expect(resolvedItem).toBeDefined();
    expect(resolvedItem?.kind).toBe(3);
    expect(resolvedItem?.documentation).toBeDefined();
    expect((resolvedItem?.documentation as MarkupContent).value).toContain(`(${md.bold('alias')}) ${md.inlineCode('ll')}`);
  });

  it('includes local variable onCompletionResolve', async () => {
    const content = [
      'set my_var "hello world"',
      'echo $my_var',
    ].join('\n');

    const doc = createFakeLspDocument('/tmp/foo.fish', content);
    analyzer.analyze(doc);

    const params: CompletionParams = {
      textDocument: { uri: doc.uri },
      position: { line: 1, character: 10 },
    };

    const result = await server.onCompletion(params);
    const item = result.items.find(i => i.label === 'my_var');
    const resolvedItem = await server.onCompletionResolve(item!);
    // logger.log({ resolvedItem })

    expect(resolvedItem).toBeDefined();
    expect(resolvedItem?.kind).toBe(6);
    expect(resolvedItem?.documentation).toBeDefined();
    expect((resolvedItem?.documentation as MarkupContent).value).toContain(`(${md.bold('variable')}) ${md.inlineCode('my_var')}`);
  });

  it.skip('includes global variable onCompletionResolve', async () => {
    const content = [
      'export PATH="/usr/local/bin:$PATH"',
      'echo $PATH',
    ].join('\n');

    const doc = createFakeLspDocument('/tmp/foo.fish', content);
    analyzer.analyze(doc);

    const params: CompletionParams = {
      textDocument: { uri: doc.uri },
      position: { line: 1, character: 10 },
    };

    const result = await server.onCompletion(params);
    const item = result.items.find(i => i.label === 'PATH');
    const resolvedItem = await server.onCompletionResolve(item!);
    logger.log({ resolvedItem });
    // console.log({ doc: resolvedItem.documentation });

    expect(resolvedItem).toBeDefined();
    expect(resolvedItem?.kind).toBe(6);
    expect(resolvedItem?.documentation).toBeDefined();
    expect((resolvedItem?.documentation as MarkupContent).value).toContain(`(${md.bold('variable')}) ${md.inlineCode('PATH')}`);
  });

  it('includes builtin onCompletionResolve', async () => {
    const content = ['echo "hello world" | string split', 'string'].join('\n');
    const doc = createFakeLspDocument('/tmp/foo.fish', content);
    analyzer.analyze(doc);

    const params: CompletionParams = {
      textDocument: { uri: doc.uri },
      position: { line: 1, character: 6 },
    };

    const result = await server.onCompletion(params);
    const item = result.items.find(i => i.label === 'string');
    const resolvedItem = await server.onCompletionResolve(item!);
    logger.log({ resolvedItem });

    expect(resolvedItem).toBeDefined();
    expect(resolvedItem?.kind).toBe(14);
    expect(resolvedItem?.documentation).toBeDefined();
    const matchStr = [
      md.bold('STRING'),
      '-',
      md.italic('https://fishshell.com/docs/current/cmds/string.html'),
    ].join(' ');
    expect((resolvedItem?.documentation as MarkupContent).value).toContain(matchStr);
  });
});
