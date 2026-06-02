import { analyzer, Analyzer } from '../src/analyze';
import { setLogger } from './helpers';
import { getRange } from '../src/utils/tree-sitter';
import { isCommandWithName, isOption, isVariableDefinitionName } from '../src/utils/node-types';
import { initializeParser } from '../src/parser';
import { setupProcessEnvExecFile } from '../src/utils/process-env';
import TestWorkspace from './test-workspace-utils';
import { logger } from '../src/logger';
import { LspDocument } from '../src/document';
import { Location, Position } from 'vscode-languageserver';

beforeEach(() => {
  logger.setSilent();
});
afterEach(() => {
  logger.setSilent(true);
});

/**
 * A `set -q NAME` query joined to a `set … NAME` definition in one conditional
 * chain (`||`/`&&`/`;or`/`;and`/newline-`or`) is the idiomatic "define-if-unset"
 * pattern, e.g.
 *
 *     set -q EDITOR || set -gx EDITOR nvim
 *     #      ^^^^^^            ^^^^^^
 *     #      reference         definition
 *
 * The query's NAME counts as a reference to the definition when the query could
 * actually be observing the value that the definition creates:
 *
 *   • EXPLICIT-scope query (`-lq`, `-gq`, …): the query inspects exactly one
 *     scope, so it references the definition IFF that scope == the def scope.
 *   • AMBIGUOUS query (`-q`, no scope flag): `set -q` tests every scope, so it
 *     references the definition only when the def is global/universal — a query
 *     placed before a local/function definition cannot be observing that
 *     not-yet-created binding.
 *
 * Required preconditions for the guard: same document, same variable name, the
 * query positioned before the definition, both in the same conditional chain.
 */
describe('guarded `set -q` query prefixing a `set` definition', () => {
  setLogger();
  beforeEach(async () => {
    await setupProcessEnvExecFile();
    await initializeParser();
    await Analyzer.initialize();
    await setupProcessEnvExecFile();
  });

  const workspace = TestWorkspace.create().addFiles(
    {
      // Inside a function the ambiguous-query fallback scope resolves to
      // `function`, which is what exposed the original bug: a bare `set -q`
      // failed to match a `set -gx` (global) definition.
      relativePath: 'functions/guard_pipe.fish',
      content: [
        'function guard_pipe',                              // 0
        '  set -q AMB_GLOBAL || set -gx AMB_GLOBAL nvim',   // 1 ambiguous -> global : MATCH
        '  set -gq EXP_GLOBAL || set -gx EXP_GLOBAL nvim',  // 2 explicit g -> global : MATCH
        '  set -lq EXP_LOCAL || set -l EXP_LOCAL nvim',     // 3 explicit l -> local  : MATCH
        '  set -lq MIS_LG || set -gx MIS_LG nvim',          // 4 explicit l -> global : NO MATCH
        '  set -q AMB_LOCAL || set -l AMB_LOCAL nvim',      // 5 ambiguous -> local   : NO MATCH
        'end',                                              // 6
      ].join('\n'),
    },
    {
      // newline-`or` topology: tree-sitter leaves the query as a sibling of the
      // `conditional_execution` (not wrapped inside it). Behavior must match the
      // `||` form for every operator.
      relativePath: 'functions/guard_or.fish',
      content: [
        'function guard_or',           // 0
        '  set -lq OR_LOCAL',          // 1 explicit l -> local  : MATCH
        '  or set -l OR_LOCAL nvim',   // 2
        '  set -q OR_GLOBAL',          // 3 ambiguous   -> global : MATCH
        '  or set -gx OR_GLOBAL nvim', // 4
        '  set -lq OR_MIS',            // 5 explicit l -> global : NO MATCH
        '  or set -gx OR_MIS nvim',    // 6
        'end',                         // 7
      ].join('\n'),
    },
    {
      // Root level of a conf.d file: the ambiguous-query fallback already
      // resolves to `global`, so these passed before the fix too — kept as a
      // regression anchor for the canonical EDITOR/VISUAL idioms.
      relativePath: 'conf.d/editor.fish',
      content: [
        'set -q EDITOR || set -gx EDITOR nvim', // 0 ambiguous -> global : MATCH
        'set -q VISUAL',                        // 1 ambiguous -> global : MATCH
        'or set -gx VISUAL nvim',               // 2
      ].join('\n'),
    },
    {
      // A *local* EDITOR in a different file. Its explicit-local query must
      // resolve to this local definition and must NOT leak into the global
      // EDITOR's references (cross-file scope mismatch).
      relativePath: 'conf.d/local-editor.fish',
      content: [
        'set -ql EDITOR || set -lx EDITOR nvim', // 0 explicit l -> local : MATCH (own file only)
      ].join('\n'),
    },
  ).initialize();

  // Locates the query-NAME node (the bare NAME argument of a `set -q…` command)
  // and the definition node for `name` within `doc`.
  function queryAndDef(doc: LspDocument, name: string) {
    const nodes = analyzer.getNodes(doc.uri);
    const def = nodes.find(n => n.text === name && isVariableDefinitionName(n))!;
    const query = nodes.find(n =>
      n.text === name
      && !isVariableDefinitionName(n)
      && !!n.parent
      && isCommandWithName(n.parent, 'set')
      && n.parent.children.some(c => isOption(c) && /^-\w*q/.test(c.text)),
    )!;
    return { def, query };
  }

  function hasRefAt(refs: Location[], pos: Position) {
    return refs.some(loc =>
      loc.range.start.line === pos.line
      && loc.range.start.character === pos.character);
  }

  function expectGuard(rel: string, name: string, shouldMatch: boolean) {
    const doc = workspace.getDocument(rel)!;
    const { def, query } = queryAndDef(doc, name);
    expect(def, `definition node for ${name}`).toBeDefined();
    expect(query, `query node for ${name}`).toBeDefined();
    const refs = analyzer.getReferences(doc, getRange(def).start);
    expect(hasRefAt(refs, getRange(query).start)).toBe(shouldMatch);
  }

  describe('`||` form (query wrapped in the same conditional_execution)', () => {
    it('ambiguous `set -q` references a global definition', () => {
      expectGuard('functions/guard_pipe.fish', 'AMB_GLOBAL', true);
    });
    it('explicit `set -gq` references a global definition', () => {
      expectGuard('functions/guard_pipe.fish', 'EXP_GLOBAL', true);
    });
    it('explicit `set -lq` references a matching local definition', () => {
      expectGuard('functions/guard_pipe.fish', 'EXP_LOCAL', true);
    });
    it('explicit `set -lq` does NOT reference a global definition (scope mismatch)', () => {
      expectGuard('functions/guard_pipe.fish', 'MIS_LG', false);
    });
    it('ambiguous `set -q` does NOT reference a local definition (pre-definition local)', () => {
      expectGuard('functions/guard_pipe.fish', 'AMB_LOCAL', false);
    });
  });

  describe('newline-`or` form (query is a sibling of the conditional_execution)', () => {
    it('explicit `set -lq` references a matching local definition', () => {
      expectGuard('functions/guard_or.fish', 'OR_LOCAL', true);
    });
    it('ambiguous `set -q` references a global definition', () => {
      expectGuard('functions/guard_or.fish', 'OR_GLOBAL', true);
    });
    it('explicit `set -lq` does NOT reference a global definition (scope mismatch)', () => {
      expectGuard('functions/guard_or.fish', 'OR_MIS', false);
    });
  });

  describe('conf.d root-level idioms', () => {
    it('ambiguous `set -q EDITOR || set -gx EDITOR` includes the query as a reference', () => {
      expectGuard('conf.d/editor.fish', 'EDITOR', true);
    });
    it('ambiguous `set -q VISUAL; or set -gx VISUAL` includes the query as a reference', () => {
      expectGuard('conf.d/editor.fish', 'VISUAL', true);
    });
  });

  describe('cross-file scope isolation (a `set -ql` query is not a global reference)', () => {
    it('global EDITOR references exclude an explicit-local query in another file', () => {
      const globalDoc = workspace.getDocument('conf.d/editor.fish')!;
      const localDoc = workspace.getDocument('conf.d/local-editor.fish')!;
      const { def } = queryAndDef(globalDoc, 'EDITOR');
      const refs = analyzer.getReferences(globalDoc, getRange(def).start);
      // All references must live in the defining (global) file.
      expect(refs.every(loc => loc.uri === globalDoc.uri)).toBeTruthy();
      expect(refs.some(loc => loc.uri === localDoc.uri)).toBeFalsy();
    });

    it('local EDITOR references (resolved from its guarding query) stay in their own file', () => {
      const localDoc = workspace.getDocument('conf.d/local-editor.fish')!;
      const { def, query } = queryAndDef(localDoc, 'EDITOR');
      // Resolving from the query node (which precedes the definition) must find
      // the local definition and report both local locations — and nothing from
      // the global EDITOR file.
      const refs = analyzer.getReferences(localDoc, getRange(query).start);
      expect(refs.every(loc => loc.uri === localDoc.uri)).toBeTruthy();
      expect(hasRefAt(refs, getRange(query).start)).toBeTruthy();
      expect(hasRefAt(refs, getRange(def).start)).toBeTruthy();
    });
  });
});
