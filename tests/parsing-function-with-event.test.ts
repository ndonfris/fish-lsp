import { createTestWorkspace, fail, setLogger, TestLspDocument } from './helpers';
import { SyntaxNode } from 'web-tree-sitter';
import { initializeParser } from '../src/parser';
import { Analyzer, analyzer } from '../src/analyze';
import { FishSymbol } from '../src/parsing/symbol';
import { LspDocument } from '../src/document';
import { flattenNested } from '../src/utils/flatten';
import { getDiagnosticsAsync } from '../src/diagnostics/validate';
import { ErrorCodes } from '../src/diagnostics/error-codes';
import { config } from '../src/config';
import FishServer from '../src/server';

const inputDocs: TestLspDocument[] = [];
let documents: LspDocument[] = [];

describe('FishSymbol parsing functions tests', () => {
  setLogger();

  beforeAll(async () => {
    await Analyzer.initialize();
    config.fish_lsp_diagnostic_disable_error_codes = [ErrorCodes.requireAutloadedFunctionHasDescription];
  });

  describe('initialized', () => {
    it('should initialize the parser', async () => {
      const parser = await initializeParser();
      expect(parser).toBeDefined();
    });

    it('should have a valid analyzer instance', async () => {
      expect(analyzer).toBeInstanceOf(Analyzer);
    });
  });

  describe('analyze workspace 1: `function`', () => {
    const inputDocs = [
      {
        path: 'functions/fish_function.fish',
        text: 'function my_function; echo "Hello, World!"; end',
      },
      {
        path: 'functions/another_function.fish',
        text: 'function another_function --on-event fish_prompt; echo "This is another function"; end',
      },
      {
        path: 'config.fish',
        text: '',
      },
    ];

    beforeEach(async () => {
      documents = createTestWorkspace(analyzer, ...inputDocs);
    });

    it('should analyze a simple function definition', async () => {
      const config = documents.find(doc => doc.path.endsWith('config.fish'))!;
      const hookFunction = documents.find(doc => doc.path.endsWith('functions/another_function.fish'))!;
      if (!hookFunction || !config) fail();
      expect(config).toBeDefined();
      expect(hookFunction).toBeDefined();

      const configCached = analyzer.analyze(config);
      const hookFunctionCached = analyzer.analyze(hookFunction);
      expect(configCached).toBeDefined();
      expect(hookFunctionCached).toBeDefined();

      const functionSymbol = flattenNested(...hookFunctionCached.documentSymbols).find(s => s.isFunction());
      expect(functionSymbol).toBeDefined();

      console.log('functionSymbol?.hasEventHook(): ', functionSymbol?.hasEventHook());
      expect(functionSymbol?.hasEventHook()).toBeTruthy();

      // expect(functionSymbol?.isAutoloaded()).toBeDefined();
    });
  });

  describe('analyze workspace 2: `abbr`', () => {
    const inputDocs = [
      {
        path: 'conf.d/abbreviations.fish',
        text: [
          'if status is-interactive',
          '  function git_quick_stash',
          '    string join \' \' -- git stash push -a -m "chore: $(date +%Y-%m-%dT%H:%M:%S)"',
          '  end',
          '  abbr -a gstq --function git_quick_stash',
          'end',
        ].join('\n'),
      },
      {
        path: 'config.fish',
        text: '',
      },
    ];

    beforeEach(async () => {
      documents = createTestWorkspace(analyzer, ...inputDocs);
      await FishServer.setupForTestUtilities();
    });

    it('should analyze a simple function definition', async () => {
      const config = documents.find(doc => doc.path.endsWith('config.fish'))!;
      const functionDoc = documents.find(doc => doc.path.endsWith('conf.d/abbreviations.fish'))!;
      if (!functionDoc || !config) fail();
      expect(config).toBeDefined();
      expect(functionDoc).toBeDefined();

      const configCached = analyzer.analyze(config);
      const functionCached = analyzer.analyze(functionDoc);
      expect(configCached).toBeDefined();
      expect(functionCached).toBeDefined();

      const functionSymbol = flattenNested(...functionCached.documentSymbols).find(s => s.isFunction());
      expect(functionSymbol).toBeDefined();

      expect(functionSymbol?.isFunction()).toBeTruthy();

      const diagnostics = await getDiagnosticsAsync(functionCached.root!, functionCached.document);
      console.log({
        diagnostics: diagnostics.map(d => ({
          code: d.code,
          message: d.message,
        })),
      });
      expect(diagnostics.length).toBe(0);
    });
  });

  describe('analyze workspace 3: `bind`', () => {
    const inputDocs = [
      {
        path: 'conf.d/bindings.fish',
        text: [
          'function used_bindings',
          '    echo \'This keybind is used\'',
          'end',
          'if status is-interactive',
          '  function down-or-nextd-or-forward-word -d "if in completion mode(pager), then move down, otherwise, nextd-or-forward-word"',
          '      # if the pager is not visible, then execute the nextd-or-forward-word',
          '      # function',
          '      if not commandline --paging-mode; and not commandline --search-mode',
          '          commandline -f nextd-or-forward-word',
          '          return',
          '      # if the pager is visible, then move down one item',
          '      else',
          '          commandline -f down-line',
          '         return',
          '      end',
          '  end',
          '  function unused-keybind',
          '     echo \'This keybind is not used\'',
          '  end',
          '  function fish_user_key_bindings',
          '    bind ctrl-j down-or-nextd-or-forward-word',
          '    bind ctrl-l used_bindings',
          '  end',
          'end',
        ].join('\n'),
      },
      {
        path: 'config.fish',
        text: 'fish_user_key_bindings',
      },
    ];

    beforeEach(async () => {
      documents = createTestWorkspace(analyzer, ...inputDocs);
    });

    it('should analyze a simple function definition', async () => {
      const config = documents.find(doc => doc.path.endsWith('config.fish'))!;
      const bindDoc = documents.find(doc => doc.path.endsWith('conf.d/bindings.fish'))!;
      if (!bindDoc || !config) fail();
      expect(config).toBeDefined();
      expect(bindDoc).toBeDefined();

      const configCached = analyzer.analyze(config);
      const bindCached = analyzer.analyze(bindDoc);
      expect(configCached).toBeDefined();
      expect(bindCached).toBeDefined();

      const bindSymbol = flattenNested(...bindCached.documentSymbols).find(s => s.isFunction() && s.name === 'fish_user_key_bindings');
      expect(bindSymbol).toBeDefined();

      expect(bindSymbol?.isFunction()).toBeTruthy();

      const diagnostics = await getDiagnosticsAsync(bindCached.root!, bindCached.document);
      expect(diagnostics.length).toBe(0);
      diagnostics.forEach((d, idx) => {
        console.log({
          idx,
          code: d.code,
          message: d.message,
          severity: d.severity,
          data: {
            node: d.data.node.text,
          },
          range: d.range,
          source: d.source,
        });
      });
    });
  });
});

