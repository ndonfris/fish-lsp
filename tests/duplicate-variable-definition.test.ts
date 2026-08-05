import { analyzer, Analyzer } from '../src/analyze';
import { initializeParser } from '../src/parser';
import { setupProcessEnvExecFile } from '../src/utils/process-env';
import { setLogger } from './helpers';
import TestWorkspace from './test-workspace-utils';

describe('duplicate variable definitions', () => {
  setLogger();

  beforeEach(async () => {
    await setupProcessEnvExecFile();
    await initializeParser();
    await Analyzer.initialize();
    await setupProcessEnvExecFile();
  });

  describe('same-file bindings', () => {
    const workspace = TestWorkspace.create().addFiles({
      relativePath: 'my_func.fish',
      content: [
        'function my_func',
        '    set -f var',
        '    for i in (seq 1 10)',
        '        set -a var $i',
        '    end',
        'end',
      ].join('\n'),
    }, {
      relativePath: 'nested_shadow.fish',
      content: [
        'function nested_shadow',
        '    set -f var outer',
        '    for i in (seq 1 10)',
        '        set -l var inner',
        '    end',
        'end',
      ].join('\n'),
    }, {
      relativePath: 'erase_and_redefine.fish',
      content: [
        'function erase_and_redefine',
        '    set -f var first',
        '    set -ef var',
        '    set -f var second',
        '    echo $var',
        'end',
      ].join('\n'),
    }, {
      relativePath: 'same_scope_redefinitions.fish',
      content: [
        'function same_scope_redefinitions',
        '    set -f var first',
        '    set -a var second',
        '    set var third',
        '    echo $var',
        'end',
      ].join('\n'),
    }, {
      relativePath: 'shadow_and_restore.fish',
      content: [
        'function shadow_and_restore',
        '    set -f var outer',
        '    echo $var',
        '    for i in (seq 1 10)',
        '        set -l var inner',
        '        echo $var',
        '    end',
        '    echo $var',
        'end',
      ].join('\n'),
    }, {
      relativePath: 'sibling_scopes.fish',
      content: [
        'function sibling_scopes',
        '    for i in (seq 1 10)',
        '        set -l var first',
        '        echo $var',
        '    end',
        '    for i in (seq 1 10)',
        '        set -l var second',
        '        echo $var',
        '    end',
        'end',
      ].join('\n'),
    }, {
      relativePath: 'nested_functions.fish',
      content: [
        'function outer',
        '    set -f var outer',
        '    function inner',
        '        set -f var inner',
        '        echo $var',
        '    end',
        '    echo $var',
        'end',
      ].join('\n'),
    }).initialize();

    it('resolves a nested append to the first definition in the function scope', () => {
      const doc = workspace.getDocument('my_func.fish')!;

      const locations = analyzer.getDefinitionLocation(doc, { line: 3, character: 15 });

      expect(locations).toHaveLength(1);
      expect(locations[0]?.range.start).toEqual({ line: 1, character: 11 });
    });

    it('keeps both writes associated when references start at the first definition', () => {
      const doc = workspace.getDocument('my_func.fish')!;

      const references = analyzer.getReferences(doc, { line: 1, character: 11 });

      expect(references.map(location => location.range.start.line)).toEqual([1, 3]);
    });

    it('keeps an explicit nested local definition separate from the outer function binding', () => {
      const doc = workspace.getDocument('nested_shadow.fish')!;

      const locations = analyzer.getDefinitionLocation(doc, { line: 3, character: 15 });

      expect(locations).toHaveLength(1);
      expect(locations[0]?.range.start).toEqual({ line: 3, character: 15 });
    });

    it('resolves a definition after erase to the new binding', () => {
      const doc = workspace.getDocument('erase_and_redefine.fish')!;

      const definitionLocations = analyzer.getDefinitionLocation(doc, { line: 3, character: 11 });
      const referenceLocations = analyzer.getDefinitionLocation(doc, { line: 4, character: 10 });

      expect(definitionLocations).toHaveLength(1);
      expect(definitionLocations[0]?.range.start).toEqual({ line: 3, character: 11 });
      expect(referenceLocations).toHaveLength(1);
      expect(referenceLocations[0]?.range.start).toEqual({ line: 3, character: 11 });
    });

    it('keeps references on opposite sides of an erase in separate binding lifetimes', () => {
      const doc = workspace.getDocument('erase_and_redefine.fish')!;

      const firstReferences = analyzer.getReferences(doc, { line: 1, character: 11 });
      const secondReferences = analyzer.getReferences(doc, { line: 3, character: 11 });

      expect(firstReferences.map(location => location.range.start.line)).toEqual([1, 2]);
      expect(secondReferences.map(location => location.range.start.line)).toEqual([3, 4]);
    });

    it('resolves every same-scope write and read to the first definition', () => {
      const doc = workspace.getDocument('same_scope_redefinitions.fish')!;

      for (const position of [
        { line: 2, character: 11 },
        { line: 3, character: 8 },
        { line: 4, character: 10 },
      ]) {
        const locations = analyzer.getDefinitionLocation(doc, position);
        expect(locations).toHaveLength(1);
        expect(locations[0]?.range.start).toEqual({ line: 1, character: 11 });
      }
    });

    it('uses the nested shadow only inside its block and restores the outer binding afterward', () => {
      const doc = workspace.getDocument('shadow_and_restore.fish')!;

      const beforeShadow = analyzer.getDefinitionLocation(doc, { line: 2, character: 10 });
      const shadowDefinition = analyzer.getDefinitionLocation(doc, { line: 4, character: 15 });
      const insideShadow = analyzer.getDefinitionLocation(doc, { line: 5, character: 14 });
      const afterShadow = analyzer.getDefinitionLocation(doc, { line: 7, character: 10 });

      expect(beforeShadow[0]?.range.start).toEqual({ line: 1, character: 11 });
      expect(shadowDefinition[0]?.range.start).toEqual({ line: 4, character: 15 });
      expect(insideShadow[0]?.range.start).toEqual({ line: 4, character: 15 });
      expect(afterShadow[0]?.range.start).toEqual({ line: 1, character: 11 });
    });

    it('keeps same-named explicit locals in sibling blocks independent', () => {
      const doc = workspace.getDocument('sibling_scopes.fish')!;
      const definitions = analyzer.getFlatDocumentSymbols(doc.uri)
        .filter(symbol => symbol.name === 'var' && symbol.fishKind === 'SET');

      expect(definitions).toHaveLength(2);
      expect(definitions[0]?.getFunctionOwner()?.id).toBe(definitions[1]?.getFunctionOwner()?.id);
      expect(definitions[0]?.scopeNode.equals(definitions[1]!.scopeNode)).toBe(false);

      const firstReference = analyzer.getDefinitionLocation(doc, { line: 3, character: 14 });
      const secondDefinition = analyzer.getDefinitionLocation(doc, { line: 6, character: 15 });
      const secondReference = analyzer.getDefinitionLocation(doc, { line: 7, character: 14 });

      expect(firstReference[0]?.range.start).toEqual({ line: 2, character: 15 });
      expect(secondDefinition[0]?.range.start).toEqual({ line: 6, character: 15 });
      expect(secondReference[0]?.range.start).toEqual({ line: 6, character: 15 });
    });

    it('keeps same-named variables in nested functions isolated by function owner', () => {
      const doc = workspace.getDocument('nested_functions.fish')!;

      const innerReference = analyzer.getDefinitionLocation(doc, { line: 4, character: 14 });
      const outerReference = analyzer.getDefinitionLocation(doc, { line: 6, character: 10 });

      expect(innerReference[0]?.range.start).toEqual({ line: 3, character: 15 });
      expect(outerReference[0]?.range.start).toEqual({ line: 1, character: 11 });
    });
  });

  describe('function ownership and non-variable definitions', () => {
    const workspace = TestWorkspace.create().addFiles({
      relativePath: 'function_scopes.fish',
      content: [
        'function function_scopes',
        '    function helper',
        '    end',
        '    helper',
        'end',
        'function helper',
        'end',
        'function_scopes',
        'helper',
      ].join('\n'),
    }, {
      relativePath: 'events.fish',
      content: [
        'set -g root_var',
        'function event_handler --on-event shared_event',
        'end',
        'emit shared_event',
        'emit shared_event',
        'function event_owner',
        '    emit nested_event',
        'end',
      ].join('\n'),
    }).initialize();

    it('reports function ownership for root, nested, event, and variable symbols', () => {
      const functionDoc = workspace.getDocument('function_scopes.fish')!;
      const functionSymbols = analyzer.getFlatDocumentSymbols(functionDoc.uri);
      const outer = functionSymbols.find(symbol =>
        symbol.name === 'function_scopes' && symbol.fishKind === 'FUNCTION',
      )!;
      const helpers = functionSymbols.filter(symbol =>
        symbol.name === 'helper' && symbol.fishKind === 'FUNCTION',
      );
      const nestedHelper = helpers.find(symbol => symbol.getFunctionOwner()?.equals(outer))!;
      const rootHelper = helpers.find(symbol => !symbol.getFunctionOwner())!;

      expect(outer.getFunctionOwner()).toBeUndefined();
      expect(rootHelper.getFunctionOwner()).toBeUndefined();
      expect(nestedHelper.getFunctionOwner()?.id).toBe(outer.id);

      const eventDoc = workspace.getDocument('events.fish')!;
      const eventSymbols = analyzer.getFlatDocumentSymbols(eventDoc.uri);
      const rootVariable = eventSymbols.find(symbol => symbol.name === 'root_var')!;
      const handler = eventSymbols.find(symbol =>
        symbol.name === 'event_handler' && symbol.fishKind === 'FUNCTION',
      )!;
      const eventOwner = eventSymbols.find(symbol =>
        symbol.name === 'event_owner' && symbol.fishKind === 'FUNCTION',
      )!;
      const eventHook = eventSymbols.find(symbol => symbol.fishKind === 'FUNCTION_EVENT')!;
      const rootEmit = eventSymbols.find(symbol =>
        symbol.name === 'shared_event' && symbol.fishKind === 'EVENT',
      )!;
      const nestedEmit = eventSymbols.find(symbol =>
        symbol.name === 'nested_event' && symbol.fishKind === 'EVENT',
      )!;

      expect(rootVariable.getFunctionOwner()).toBeUndefined();
      expect(handler.getFunctionOwner()).toBeUndefined();
      expect(eventHook.getFunctionOwner()?.id).toBe(handler.id);
      expect(rootEmit.getFunctionOwner()).toBeUndefined();
      expect(nestedEmit.getFunctionOwner()?.id).toBe(eventOwner.id);
    });

    it('resolves same-named nested and root function calls to their own definitions', () => {
      const doc = workspace.getDocument('function_scopes.fish')!;

      const nestedCall = analyzer.getDefinitionLocation(doc, { line: 3, character: 4 });
      const rootCall = analyzer.getDefinitionLocation(doc, { line: 8, character: 0 });

      expect(nestedCall).toHaveLength(1);
      expect(nestedCall[0]?.range.start).toEqual({ line: 1, character: 13 });
      expect(rootCall).toHaveLength(1);
      expect(rootCall[0]?.range.start).toEqual({ line: 5, character: 9 });
    });

    it('keeps event hooks and each emitted event as distinct definition sites', () => {
      const doc = workspace.getDocument('events.fish')!;
      const sharedEvents = analyzer.getFlatDocumentSymbols(doc.uri)
        .filter(symbol => symbol.name === 'shared_event' && symbol.isEvent());

      expect(sharedEvents).toHaveLength(3);
      for (const event of sharedEvents) {
        const definitions = analyzer.getDefinitionLocation(doc, event.selectionRange.start);
        expect(definitions).toHaveLength(1);
        expect(definitions[0]).toEqual(event.toLocation());
      }
    });
  });

  describe('transparent function bindings', () => {
    const workspace = TestWorkspace.create().addFiles(
      {
        relativePath: 'functions/my_func.fish',
        content: [
          'function my_func',
          '    set -f var',
          '    shared_append',
          'end',
        ].join('\n'),
      },
      {
        relativePath: 'functions/shared_append.fish',
        content: [
          'function shared_append --no-scope-shadowing',
          '    for i in (seq 1 10)',
          '        set -a var $i',
          '    end',
          'end',
        ].join('\n'),
      },
      {
        relativePath: 'functions/inherit_caller.fish',
        content: [
          'function inherit_caller',
          '    set -f var',
          '    inherited_append',
          'end',
        ].join('\n'),
      },
      {
        relativePath: 'functions/inherited_append.fish',
        content: [
          'function inherited_append --inherit-variable var',
          '    for i in (seq 1 10)',
          '        set -a var $i',
          '    end',
          'end',
        ].join('\n'),
      },
      {
        relativePath: 'functions/scope_chain_root.fish',
        content: [
          'function scope_chain_root',
          '    set -f chain',
          '    scope_chain_middle',
          'end',
        ].join('\n'),
      },
      {
        relativePath: 'functions/scope_chain_middle.fish',
        content: [
          'function scope_chain_middle --no-scope-shadowing',
          '    for i in (seq 1 10)',
          '        set -a chain $i',
          '    end',
          '    scope_chain_leaf',
          'end',
        ].join('\n'),
      },
      {
        relativePath: 'functions/scope_chain_leaf.fish',
        content: [
          'function scope_chain_leaf --no-scope-shadowing',
          '    for i in (seq 1 10)',
          '        set -a chain $i',
          '    end',
          'end',
        ].join('\n'),
      },
      {
        relativePath: 'functions/inherit_chain_root.fish',
        content: [
          'function inherit_chain_root',
          '    set -f chain',
          '    inherit_chain_middle',
          'end',
        ].join('\n'),
      },
      {
        relativePath: 'functions/inherit_chain_middle.fish',
        content: [
          'function inherit_chain_middle --inherit-variable chain',
          '    for i in (seq 1 10)',
          '        set -a chain $i',
          '    end',
          '    inherit_chain_leaf',
          'end',
        ].join('\n'),
      },
      {
        relativePath: 'functions/inherit_chain_leaf.fish',
        content: [
          'function inherit_chain_leaf --inherit-variable chain',
          '    for i in (seq 1 10)',
          '        set -a chain $i',
          '    end',
          'end',
        ].join('\n'),
      },
    ).initialize();

    it('resolves a nested write in a cross-file --no-scope-shadowing function to its caller', () => {
      const caller = workspace.getDocument('functions/my_func.fish')!;
      const callee = workspace.getDocument('functions/shared_append.fish')!;

      const locations = analyzer.getDefinitionLocation(callee, { line: 2, character: 15 });

      expect(locations).toHaveLength(1);
      expect(locations[0]?.uri).toBe(caller.uri);
      expect(locations[0]?.range.start).toEqual({ line: 1, character: 11 });
    });

    it('resolves a nested write in an --inherit-variable function to its caller', () => {
      const caller = workspace.getDocument('functions/inherit_caller.fish')!;
      const callee = workspace.getDocument('functions/inherited_append.fish')!;

      const locations = analyzer.getDefinitionLocation(callee, { line: 2, character: 15 });

      expect(locations).toHaveLength(1);
      expect(locations[0]?.uri).toBe(caller.uri);
      expect(locations[0]?.range.start).toEqual({ line: 1, character: 11 });
    });

    it('resolves nested writes through a multi-hop --no-scope-shadowing chain', () => {
      const root = workspace.getDocument('functions/scope_chain_root.fish')!;
      const middle = workspace.getDocument('functions/scope_chain_middle.fish')!;
      const leaf = workspace.getDocument('functions/scope_chain_leaf.fish')!;

      const middleLocations = analyzer.getDefinitionLocation(middle, { line: 2, character: 15 });
      const leafLocations = analyzer.getDefinitionLocation(leaf, { line: 2, character: 15 });

      for (const locations of [middleLocations, leafLocations]) {
        expect(locations).toHaveLength(1);
        expect(locations[0]?.uri).toBe(root.uri);
        expect(locations[0]?.range.start).toEqual({ line: 1, character: 11 });
      }
    });

    it('resolves nested writes through a multi-hop --inherit-variable chain', () => {
      const root = workspace.getDocument('functions/inherit_chain_root.fish')!;
      const middle = workspace.getDocument('functions/inherit_chain_middle.fish')!;
      const leaf = workspace.getDocument('functions/inherit_chain_leaf.fish')!;

      const middleLocations = analyzer.getDefinitionLocation(middle, { line: 2, character: 15 });
      const leafLocations = analyzer.getDefinitionLocation(leaf, { line: 2, character: 15 });

      for (const locations of [middleLocations, leafLocations]) {
        expect(locations).toHaveLength(1);
        expect(locations[0]?.uri).toBe(root.uri);
        expect(locations[0]?.range.start).toEqual({ line: 1, character: 11 });
      }
    });
  });

  describe('common list-building idioms', () => {
    const workspace = TestWorkspace.create().addFiles({
      relativePath: 'while_append.fish',
      content: [
        'function while_append',
        '    set -f var',
        '    while read -l line',
        '        set -a var $line',
        '    end',
        'end',
      ].join('\n'),
    }, {
      relativePath: 'if_append.fish',
      content: [
        'function if_append',
        '    set -f var',
        '    if test -d /tmp',
        '        set -a var a',
        '    else',
        '        set -p var b',
        '    end',
        '    echo $var',
        'end',
      ].join('\n'),
    }, {
      relativePath: 'nested_for_append.fish',
      content: [
        'function nested_for_append',
        '    set -f matrix',
        '    for i in (seq 3)',
        '        for j in (seq 3)',
        '            set -a matrix $i$j',
        '        end',
        '    end',
        'end',
      ].join('\n'),
    }, {
      relativePath: 'set_q_guard.fish',
      content: [
        'function set_q_guard',
        '    set -q var; or set var default',
        '    echo $var',
        'end',
      ].join('\n'),
    }, {
      relativePath: 'command_substitution.fish',
      content: [
        'function command_substitution',
        '    set -f outer (begin; set -l inner 1; echo $inner; end)',
        '    echo $outer',
        'end',
      ].join('\n'),
    }).initialize();

    it('resolves an append inside a while block to the first definition', () => {
      const doc = workspace.getDocument('while_append.fish')!;

      const locations = analyzer.getDefinitionLocation(doc, { line: 3, character: 15 });

      expect(locations).toHaveLength(1);
      expect(locations[0]?.range.start).toEqual({ line: 1, character: 11 });
    });

    it('resolves a variable read from a while-header `read` definition', () => {
      const doc = workspace.getDocument('while_append.fish')!;

      const locations = analyzer.getDefinitionLocation(doc, { line: 3, character: 20 });

      expect(locations).toHaveLength(1);
      expect(locations[0]?.range.start).toEqual({ line: 2, character: 18 });
    });

    it('resolves appends and prepends in both if branches to the first definition', () => {
      const doc = workspace.getDocument('if_append.fish')!;

      for (const position of [
        { line: 3, character: 15 },
        { line: 5, character: 15 },
        { line: 7, character: 10 },
      ]) {
        const locations = analyzer.getDefinitionLocation(doc, position);
        expect(locations).toHaveLength(1);
        expect(locations[0]?.range.start).toEqual({ line: 1, character: 11 });
      }
    });

    it('resolves an append two for-loops deep to the function-level definition', () => {
      const doc = workspace.getDocument('nested_for_append.fish')!;

      const locations = analyzer.getDefinitionLocation(doc, { line: 4, character: 19 });

      expect(locations).toHaveLength(1);
      expect(locations[0]?.range.start).toEqual({ line: 1, character: 11 });
    });

    it('resolves a `set -q var; or set var default` guard to the fallback definition', () => {
      const doc = workspace.getDocument('set_q_guard.fish')!;

      const locations = analyzer.getDefinitionLocation(doc, { line: 2, character: 10 });

      expect(locations).toHaveLength(1);
      expect(locations[0]?.range.start).toEqual({ line: 1, character: 23 });
    });

    it('resolves definitions and reads inside a command substitution', () => {
      const doc = workspace.getDocument('command_substitution.fish')!;

      const innerRead = analyzer.getDefinitionLocation(doc, { line: 1, character: 47 });
      const outerRead = analyzer.getDefinitionLocation(doc, { line: 2, character: 10 });

      expect(innerRead).toHaveLength(1);
      expect(innerRead[0]?.range.start).toEqual({ line: 1, character: 32 });
      expect(outerRead).toHaveLength(1);
      expect(outerRead[0]?.range.start).toEqual({ line: 1, character: 11 });
    });
  });

  describe('explicit scope flags at the same block level', () => {
    const workspace = TestWorkspace.create().addFiles({
      relativePath: 'unscoped_then_local.fish',
      content: [
        'function unscoped_then_local',
        '    set var first',
        '    set -l var second',
        '    echo $var',
        'end',
      ].join('\n'),
    }, {
      relativePath: 'unscoped_then_function.fish',
      content: [
        'function unscoped_then_function',
        '    set var first',
        '    set -f var second',
        '    echo $var',
        'end',
      ].join('\n'),
    }, {
      relativePath: 'functions/autoloaded_unscoped_local.fish',
      content: [
        'function autoloaded_unscoped_local',
        '    set var first',
        '    set -l var second',
        '    echo $var',
        'end',
      ].join('\n'),
    }, {
      relativePath: 'functions/autoloaded_unscoped_function.fish',
      content: [
        'function autoloaded_unscoped_function',
        '    set var first',
        '    set -f var second',
        '    echo $var',
        'end',
      ].join('\n'),
    }).initialize();

    // These four tests pin behavior that DIVERGES from fish semantics and
    // depends on file location. In fish, an unscoped `set var` inside a
    // function is function-scoped, so a later `set -l var` or `set -f var` at
    // the same block level targets the same slot. The LSP instead derives the
    // unscoped write's scope tag from the file's autoload type
    // (getFallbackModifierScope in parsing/set.ts): 'local' in a non-autoloaded
    // script, 'function' in an autoloaded functions/ file. The explicit-scope
    // guard in symbolContainsScope then splits any explicit re-scope whose tag
    // differs — so which flag folds and which starts a new definition site
    // flips between the two file kinds. If a change unifies the fallback (or
    // teaches the guard fish's same-slot rule), update these expectations
    // deliberately.
    it('folds an explicit -l into the unscoped chain in a non-autoloaded script', () => {
      const doc = workspace.getDocument('unscoped_then_local.fish')!;

      const explicitLocal = analyzer.getDefinitionLocation(doc, { line: 2, character: 11 });
      const read = analyzer.getDefinitionLocation(doc, { line: 3, character: 10 });

      expect(explicitLocal).toHaveLength(1);
      expect(explicitLocal[0]?.range.start).toEqual({ line: 1, character: 8 });
      expect(read).toHaveLength(1);
      expect(read[0]?.range.start).toEqual({ line: 1, character: 8 });
    });

    it('splits an explicit -f into a new definition site in a non-autoloaded script', () => {
      const doc = workspace.getDocument('unscoped_then_function.fish')!;

      const explicitFunction = analyzer.getDefinitionLocation(doc, { line: 2, character: 11 });
      const read = analyzer.getDefinitionLocation(doc, { line: 3, character: 10 });

      expect(explicitFunction).toHaveLength(1);
      expect(explicitFunction[0]?.range.start).toEqual({ line: 2, character: 11 });
      expect(read).toHaveLength(1);
      expect(read[0]?.range.start).toEqual({ line: 2, character: 11 });
    });

    it('folds an explicit -f into the unscoped chain in an autoloaded function file', () => {
      const doc = workspace.getDocument('functions/autoloaded_unscoped_function.fish')!;

      const explicitFunction = analyzer.getDefinitionLocation(doc, { line: 2, character: 11 });
      const read = analyzer.getDefinitionLocation(doc, { line: 3, character: 10 });

      expect(explicitFunction).toHaveLength(1);
      expect(explicitFunction[0]?.range.start).toEqual({ line: 1, character: 8 });
      expect(read).toHaveLength(1);
      expect(read[0]?.range.start).toEqual({ line: 1, character: 8 });
    });

    it('splits an explicit -l into a new shadow site in an autoloaded function file', () => {
      const doc = workspace.getDocument('functions/autoloaded_unscoped_local.fish')!;

      const explicitLocal = analyzer.getDefinitionLocation(doc, { line: 2, character: 11 });
      const read = analyzer.getDefinitionLocation(doc, { line: 3, character: 10 });

      expect(explicitLocal).toHaveLength(1);
      expect(explicitLocal[0]?.range.start).toEqual({ line: 2, character: 11 });
      expect(read).toHaveLength(1);
      expect(read[0]?.range.start).toEqual({ line: 2, character: 11 });
    });
  });
});
