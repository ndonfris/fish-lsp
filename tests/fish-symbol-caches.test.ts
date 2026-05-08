import { initializeParser } from '../src/parser';
import { analyzer, Analyzer } from '../src/analyze';
import { setLogger } from './helpers';
import { setupProcessEnvExecFile } from '../src/utils/process-env';
import TestWorkspace from './test-workspace-utils';

describe('FishSymbolCaches', () => {
  setLogger();

  beforeEach(async () => {
    await setupProcessEnvExecFile();
    await initializeParser();
    await Analyzer.initialize();
    await setupProcessEnvExecFile();
  });

  describe('broad all-symbol subsets', () => {
    const workspace = TestWorkspace.create().addFiles(
      {
        relativePath: 'functions/foo.fish',
        content: [
          'function foo --on-event shared_event',
          '    set -l local_name one',
          '    emit shared_event',
          '    helper',
          'end',
          '',
          'function helper',
          '    set -g local_name two',
          'end',
        ].join('\n'),
      },
      {
        relativePath: 'functions/bar.fish',
        content: [
          'function bar',
          '    set -l local_name three',
          '    emit shared_event',
          'end',
        ].join('\n'),
      },
    ).initialize();

    it('should index functions by name across scopes', () => {
      expect(workspace.getDocument('functions/foo.fish')).toBeDefined();
      expect(workspace.getDocument('functions/bar.fish')).toBeDefined();

      expect(analyzer.symbols.functionsByName.has('foo')).toBe(true);
      expect(analyzer.symbols.functionsByName.has('helper')).toBe(true);
      expect(analyzer.symbols.functionsByName.has('bar')).toBe(true);

      const fooSymbols = analyzer.symbols.functionsByName.find('foo');
      const helperSymbols = analyzer.symbols.functionsByName.find('helper');
      const barSymbols = analyzer.symbols.functionsByName.find('bar');

      expect(fooSymbols.some(symbol => symbol.isFunction())).toBe(true);
      expect(helperSymbols.some(symbol => symbol.isFunction())).toBe(true);
      expect(barSymbols.some(symbol => symbol.isFunction())).toBe(true);
    });

    it('should index variables by name across scopes', () => {
      expect(analyzer.symbols.variablesByName.has('local_name')).toBe(true);

      const variables = analyzer.symbols.variablesByName.find('local_name');

      expect(variables).toHaveLength(3);
      expect(variables.every(symbol => symbol.isVariable())).toBe(true);
      expect(variables.some(symbol => symbol.isLocal())).toBe(true);
      expect(variables.some(symbol => symbol.isGlobal())).toBe(true);
    });

    it('should index emitted events and event hooks by name', () => {
      expect(analyzer.symbols.eventsByName.has('shared_event')).toBe(true);

      const events = analyzer.symbols.eventsByName.find('shared_event');

      expect(events.some(symbol => symbol.isEmittedEvent())).toBe(true);
      expect(events.some(symbol => symbol.isEventHook())).toBe(true);
      expect(events.every(symbol => symbol.isEvent())).toBe(true);
    });

    it('should cache only global or root-level symbols through the grouped helper', () => {
      const fooDoc = workspace.getDocument('functions/foo.fish')!;
      const flatSymbols = analyzer.getFlatDocumentSymbols(fooDoc.uri);

      analyzer.symbols.globalSymbols.removeSymbolsByUri(fooDoc.uri);
      analyzer.symbols.indexGlobalOrRootSymbols(flatSymbols);

      const globalNames = new Set(analyzer.symbols.globalSymbols.find('foo').map(symbol => symbol.name));
      const helperNames = new Set(analyzer.symbols.globalSymbols.find('helper').map(symbol => symbol.name));
      const localVariableNames = analyzer.symbols.globalSymbols.find('local_name').map(symbol => symbol.name);

      expect(globalNames.has('foo')).toBe(true);
      expect(helperNames.has('helper')).toBe(true);
      expect(localVariableNames).toHaveLength(1);
    });
  });
});
