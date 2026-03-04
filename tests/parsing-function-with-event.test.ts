import { fail, setLogger } from './helpers';
import { initializeParser } from '../src/parser';
import { Analyzer, analyzer } from '../src/analyze';
import { flattenNested } from '../src/utils/flatten';
import { getDiagnosticsAsync } from '../src/diagnostics/validate';
import { ErrorCodes } from '../src/diagnostics/error-codes';
import { config } from '../src/config';
import FishServer from '../src/server';
import TestWorkspace, { TestFile } from './test-workspace-utils';

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
    const workspace = TestWorkspace.create()
      .addFiles(
        TestFile.function('fish_function', 'function my_function; echo "Hello, World!"; end'),
        TestFile.function('another_function', 'function another_function --on-event fish_prompt; echo "This is another function"; end'),
        TestFile.config(''),
      ).initialize();

    it('should analyze a simple function definition', async () => {
      const config = workspace.getDocument('config.fish')!;
      const hookFunction = workspace.getDocument('functions/another_function.fish')!;
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
    const workspace = TestWorkspace.create()
      .addFiles(
        TestFile.confd('abbreviations', [
          'if status is-interactive',
          '  function git_quick_stash',
          '    string join \' \' -- git stash push -a -m "chore: $(date +%Y-%m-%dT%H:%M:%S)"',
          '  end',
          '  abbr -a gstq --function git_quick_stash',
          'end',
        ].join('\n')),
        TestFile.config(''),
      ).initialize();

    beforeEach(async () => {
      await FishServer.setupForTestUtilities();
    });

    it('should analyze a simple function definition', async () => {
      const config = workspace.getDocument('config.fish')!;
      const functionDoc = workspace.getDocument('conf.d/abbreviations.fish')!;
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
    const workspace = TestWorkspace.create()
      .addFiles(
        TestFile.confd('bindings', [
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
        ].join('\n')),
        TestFile.config('fish_user_key_bindings'),
      ).initialize();

    it('should analyze a simple function definition', async () => {
      const config = workspace.getDocument('config.fish')!;
      const bindDoc = workspace.getDocument('conf.d/bindings.fish')!;
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
