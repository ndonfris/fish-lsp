import { findAllMissingArgparseFlags } from '../src/diagnostics/missing-completions';
import { flattenNested } from '../src/utils/flatten';
import { getDiagnosticsAsync } from '../src/diagnostics/validate';
import { setLogger, fail } from './helpers';
import { Analyzer, analyzer } from '../src/analyze';
import { logger } from '../src/logger';
import { getGroupedCompletionSymbolsAsArgparse, groupCompletionSymbolsTogether } from '../src/parsing/complete';
import { config } from '../src/config';
import { ErrorCodes } from '../src/diagnostics/error-codes';
import TestWorkspace, { TestFile } from './test-workspace-utils';

describe('diagnostics with missing completions', () => {
  setLogger();

  beforeAll(async () => {
    await Analyzer.initialize();
    config.fish_lsp_diagnostic_disable_error_codes = [ErrorCodes.requireAutloadedFunctionHasDescription];
  });

  describe('analyze workspace 1: `function`', () => {
    const workspace = TestWorkspace.create()
      .addFiles(
        TestFile.function('fish_function', [
          'function fish_function',
          '  argparse a/arg1 -- $argv',
          '  or return',
          '  set -l hello "hello"',
          '  set -l world "world"',
          '  echo "$hello, $world!"',
          'end',
        ].join('\n')),
        TestFile.completion('fish_function', [
          'complete -c fish_function -s a -l arg1 -d "Argument 1"',
          'complete -c fish_function      -l arg2 -d "Argument 2"',
          'complete -c fish_function      -l arg3 -d "Argument 3"',
        ].join('\n')),
      ).initialize();

    it('should analyze a simple function definition', async () => {
      const functionDoc = workspace.getDocument('functions/fish_function.fish')!;
      const completionDoc = workspace.getDocument('completions/fish_function.fish')!;
      if (!functionDoc || !completionDoc) fail();
      expect(functionDoc).toBeDefined();
      expect(completionDoc).toBeDefined();

      const functionCached = analyzer.analyze(functionDoc);
      const completionCached = analyzer.analyze(completionDoc);
      expect(functionCached).toBeDefined();
      expect(completionCached).toBeDefined();

      const diagnostics = await getDiagnosticsAsync(functionCached.root!, functionDoc);
      expect(diagnostics.length).toBe(2);

      const flatFuncSymbols = flattenNested(...functionCached.documentSymbols).filter(s => s.isFunction() && s.isGlobal());
      const flatAutoloadedSymbols = flattenNested(...flatFuncSymbols);
      logger.debug({
        flatFuncSymbols: flatFuncSymbols.map(s => s.name),
        flatAutoloadedSymbols: flatAutoloadedSymbols.map(s => s.name),
      });
      // const missingCompletions = findAllMissingArgparseFlags(functionDoc, flatFuncSymbols);
      const completionSymbols = analyzer.getFlatCompletionSymbols(completionDoc.uri).filter(s => s.isNonEmpty());
      const completionGroups = groupCompletionSymbolsTogether(...completionSymbols);
      const missingCompletions = getGroupedCompletionSymbolsAsArgparse(completionGroups, flatAutoloadedSymbols);
      // expect(missingCompletions).toEqual();
      // logger.log({
      //   missingCompletions: missingCompletions.map(cGroup => {
      //     return {
      //       items: cGroup.map(c => ({
      //         name: c.text,
      //         description: c.description,
      //         flag: c.toFlag(),
      //         usage: c.toUsage(),
      //       })),
      //       argparse: cGroup.map(c => c.toArgparseOpt()).join('/'),
      //     };
      //   })
      // });

      const result = findAllMissingArgparseFlags(functionDoc);
      logger.log({
        result: result.map(r => ({
          code: r.code,
          message: r.message,
          range: [r.range.start.line, r.range.start.character, r.range.end.line, r.range.end.character].join(', '),
          node: r.data.node.text,
        })),
      });
    });
  });
});
