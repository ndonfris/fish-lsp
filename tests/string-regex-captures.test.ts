/**
 * TDD suite for `string [match|replace|split] -r '(?<name>...)'` named-capture
 * variable support.
 *
 * Tackle the describe blocks top-to-bottom — each phase corresponds to a step
 * in /home/ndonfris/repos/fish-lsp.discussions/string-regex/todo.md. The first
 * tests are pure-function/predicate level; later tests integrate through the
 * full analyzer and a TestWorkspace.
 *
 * From the fish manpage (string match -r):
 *   "When matching via regular expressions, string match automatically sets
 *    variables for all named capturing groups ((?<name>expression)). It will
 *    create a variable with the name of the group, in the default scope, for
 *    each named capturing group, and set it to the value of the capturing
 *    group in the first matched argument. … When --regex is used with --all
 *    … each named variable will contain a list of matches."
 */

import * as Parser from 'web-tree-sitter';
import { SyntaxNode } from 'web-tree-sitter';
import { initializeParser } from '../src/parser';
import { analyzer, Analyzer } from '../src/analyze';
import { setupProcessEnvExecFile } from '../src/utils/process-env';
import { workspaceManager } from '../src/utils/workspace-manager';
import { createFakeLspDocument, setLogger } from './helpers';
import TestWorkspace, { TestFile } from './test-workspace-utils';
import { getChildNodes } from '../src/utils/tree-sitter';
import { isCommandWithName } from '../src/utils/node-types';
import { processNestedTree } from '../src/parsing/symbol';
import { getRenames } from '../src/renames';
import { createTestServer, TestServerHandle } from './helpers';

// Phase 1 — these imports will fail until src/parsing/string-regex.ts exists.
// That import-time failure IS the first TDD signal. Once the stub file is
// created, each named export drives the next test to pass.
import {
  findStringRegexFlag,
  isStringRegexCommand,
  parseNamedCaptureGroups,
  processStringRegexCommand,
  isStringRegexCaptureDefinitionName,
  NamedCapture,
} from '../src/parsing/string-regex';
import { FishSymbol } from '../src/parsing/symbol';
import { FishRenameLocation } from '../src/renames';

let parser: Parser;

/** Walks the parse tree of `text` and returns the first `string` command node. */
function firstStringCommand(text: string): SyntaxNode {
  const root = parser.parse(text).rootNode;
  const cmd = getChildNodes(root).find(n => isCommandWithName(n, 'string'));
  if (!cmd) throw new Error(`no 'string' command found in: ${text}`);
  return cmd;
}

describe('string -r named-capture variables', () => {
  setLogger();

  beforeEach(async () => {
    await setupProcessEnvExecFile();
    parser = await initializeParser();
    await Analyzer.initialize();
  });

  afterEach(() => {
    workspaceManager.clear();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Phase 1 — Detection: the regex flag and the command shape
  // ─────────────────────────────────────────────────────────────────────────
  describe('Phase 1 — flag and command detection', () => {
    it('findStringRegexFlag finds -r', () => {
      const cmd = firstStringCommand('string match -r \'(?<x>.)\' foo');
      const flag = findStringRegexFlag(cmd);
      expect(flag).not.toBeNull();
      expect(flag!.text).toBe('-r');
    });

    it('findStringRegexFlag finds --regex', () => {
      const cmd = firstStringCommand('string match --regex \'(?<x>.)\' foo');
      expect(findStringRegexFlag(cmd)!.text).toBe('--regex');
    });

    it.each([
      ['combined -re', 'string match -re \'(?<x>.)\' foo'],
      ['combined -rq', 'string match -rq \'(?<x>.)\' foo'],
      ['combined -ra', 'string match -ra \'(?<x>.)\' foo'],
      ['combined -rqa', 'string match -rqa \'(?<x>.)\' foo'],
    ])('findStringRegexFlag recognizes %s', (_label, line) => {
      const cmd = firstStringCommand(line);
      expect(findStringRegexFlag(cmd)).not.toBeNull();
    });

    it('isStringRegexCommand is true for match/replace/split when -r is present', () => {
      expect(isStringRegexCommand(firstStringCommand('string match -r \'(?<x>.)\' a'))).toBe(true);
      expect(isStringRegexCommand(firstStringCommand('string replace -r \'(?<x>.)\' \'\$x\' a'))).toBe(true);
      expect(isStringRegexCommand(firstStringCommand('string split -r \'(?<x>.)\' a.b'))).toBe(true);
    });

    it('isStringRegexCommand is false when -r is absent', () => {
      expect(isStringRegexCommand(firstStringCommand('string match \'(?<x>.)\' a'))).toBe(false);
      expect(isStringRegexCommand(firstStringCommand('string replace foo bar a'))).toBe(false);
    });

    it('isStringRegexCommand is false for non-regex subcommands', () => {
      expect(isStringRegexCommand(firstStringCommand('string upper a'))).toBe(false);
      expect(isStringRegexCommand(firstStringCommand('string length a'))).toBe(false);
      expect(isStringRegexCommand(firstStringCommand('string lower a'))).toBe(false);
    });

    it('isStringRegexCommand respects the `--` sentinel', () => {
      // After `--`, `-r` is a literal argument, not a flag.
      expect(isStringRegexCommand(firstStringCommand('string match -- -r \'(?<x>.)\''))).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Phase 2 — Pattern parsing (pure text, no SyntaxNode involved)
  // ─────────────────────────────────────────────────────────────────────────
  describe('Phase 2 — parseNamedCaptureGroups', () => {
    it('returns an empty list for an empty pattern', () => {
      expect(parseNamedCaptureGroups('')).toEqual([]);
    });

    it('returns an empty list when there are no captures', () => {
      expect(parseNamedCaptureGroups('foo.*bar')).toEqual([]);
      expect(parseNamedCaptureGroups('(unnamed)')).toEqual([]);
    });

    it('extracts a single capture', () => {
      const result = parseNamedCaptureGroups('(?<x>.)');
      expect(result).toHaveLength(1);
      expect(result[0]!.name).toBe('x');
      // offset/length pinpoint the capture *name* inside the pattern,
      // so `pattern.slice(offset, offset + length) === name`.
      // For `(?<x>.)` the `x` sits at index 3.
      expect(result[0]!.offset).toBe(3);
      expect(result[0]!.length).toBe(1);
    });

    it('extracts multiple captures in source order', () => {
      const result = parseNamedCaptureGroups('(?<a>.)foo(?<b>.)');
      expect(result.map((c: NamedCapture) => c.name)).toEqual(['a', 'b']);
      expect(result[0]!.offset).toBeLessThan(result[1]!.offset);
    });

    it('extracts nested captures', () => {
      const result = parseNamedCaptureGroups('(?<outer>(?<inner>\\d+))');
      expect(result.map((c: NamedCapture) => c.name)).toEqual(['outer', 'inner']);
    });

    it.each([
      ['non-capturing', '(?:foo)'],
      ['lookahead', '(?=foo)'],
      ['negative lookahead', '(?!foo)'],
      ['lookbehind', '(?<=foo)'],
      ['negative lookbehind', '(?<!foo)'],
      ['inline flags', '(?i)foo'],
    ])('skips non-capture construct: %s', (_label, pattern) => {
      expect(parseNamedCaptureGroups(pattern)).toEqual([]);
    });

    it('skips escaped open-paren', () => {
      expect(parseNamedCaptureGroups('\\(?<x>foo')).toEqual([]);
    });

    it('only accepts fish-legal variable names', () => {
      // `1foo` starts with a digit; PCRE allows it, fish would refuse `set 1foo …`.
      expect(parseNamedCaptureGroups('(?<1foo>.)')).toEqual([]);
      // hyphenated names are not valid fish variable names either
      expect(parseNamedCaptureGroups('(?<my-var>.)')).toEqual([]);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Phase 3-4 — Symbol production
  // ─────────────────────────────────────────────────────────────────────────
  describe('Phase 3/4 — processStringRegexCommand → FishSymbol[]', () => {
    it('returns one STRING_REGEX symbol per capture', () => {
      const doc = createFakeLspDocument(
        'functions/cap.fish',
        [
          'function cap',
          '    string match -r \'(?<year>\\d{4})-(?<month>\\d{2})\' -- $argv',
          'end',
        ].join('\n'),
      );
      const root = parser.parse(doc.getText()).rootNode;
      const cmd = getChildNodes(root).find(n => isCommandWithName(n, 'string'))!;
      const symbols = processStringRegexCommand(doc, cmd);

      expect(symbols).toHaveLength(2);
      expect(symbols.map((s: FishSymbol) => s.name)).toEqual(['year', 'month']);
      expect(symbols.every((s: FishSymbol) => s.fishKind === 'STRING_REGEX')).toBe(true);
    });

    it('selectionRange points to the capture name inside the pattern, not the whole string', () => {
      const doc = createFakeLspDocument(
        'functions/cap.fish',
        'string match -r \'(?<year>\\d{4})\' -- "2026"',
      );
      const root = parser.parse(doc.getText()).rootNode;
      const cmd = getChildNodes(root).find(n => isCommandWithName(n, 'string'))!;
      const [sym] = processStringRegexCommand(doc, cmd);
      expect(sym).toBeDefined();

      // Source: `string match -r '(?<year>\d{4})' -- "2026"`
      //         0         1         2         3
      //         0123456789012345678901234567890123456789
      // The `year` token starts at column 20.
      expect(sym!.selectionRange.start.line).toBe(0);
      expect(sym!.selectionRange.start.character).toBe(20);
      expect(sym!.selectionRange.end.character).toBe(24);
    });

    it('returns [] when no -r/--regex flag is present', () => {
      const doc = createFakeLspDocument(
        `conf.d/${new Date().getMilliseconds()}.fish`,
        'string match \'(?<year>\\d{4})\' -- "2026"',
      );
      const root = parser.parse(doc.getText()).rootNode;
      const cmd = getChildNodes(root).find(n => isCommandWithName(n, 'string'))!;
      expect(processStringRegexCommand(doc, cmd)).toEqual([]);
    });

    it('handles -ra (--all) — symbol still produced (list-ness is a detail concern)', () => {
      const doc = createFakeLspDocument(
        `conf.d/${new Date().getMilliseconds()}.fish`,
        'string match -ra \'(?<n>\\d+)\' -- "1 2 3"',
      );
      const cmd = firstStringCommand(doc.getText());
      const [sym] = processStringRegexCommand(doc, cmd);
      expect(sym?.name).toBe('n');
    });

    it('handles double-quoted patterns', () => {
      const doc = createFakeLspDocument(
        `conf.d/${new Date().getMilliseconds()}.fish`,
        'string match -r "(?<word>\\\\w+)" -- "hello"',
      );
      const cmd = firstStringCommand(doc.getText());
      const [sym] = processStringRegexCommand(doc, cmd);
      expect(sym?.name).toBe('word');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Phase 5 — Wired into the symbol pipeline
  // ─────────────────────────────────────────────────────────────────────────
  describe('Phase 5 — processNestedTree picks up captures', () => {
    it('captures appear in the document symbol table', () => {
      const doc = createFakeLspDocument(
        'functions/wired.fish',
        [
          'function wired',
          '    string match -r \'(?<word>\\w+)\' -- $argv',
          '    echo $word',
          'end',
        ].join('\n'),
      );
      const root = parser.parse(doc.getText()).rootNode;
      const tree = processNestedTree(doc, root);

      // FishSymbol forest: function → [word]
      const wired = tree.find((s: FishSymbol) => s.name === 'wired');
      expect(wired).toBeDefined();
      const word = wired!.children.find((c: FishSymbol) => c.name === 'word');
      expect(word).toBeDefined();
      expect(word!.fishKind).toBe('STRING_REGEX');
    });

    it('isStringRegexCaptureDefinitionName recognizes the capture site', () => {
      const doc = createFakeLspDocument(
        `conf.d/${new Date().getMilliseconds()}.fish`,
        'string match -r \'(?<x>.)\' -- a',
      );
      const root = parser.parse(doc.getText()).rootNode;
      const cmd = getChildNodes(root).find(n => isCommandWithName(n, 'string'))!;
      const patternArg = cmd.childrenForFieldName('argument').find(a => a.text.includes('(?<'))!;
      expect(isStringRegexCaptureDefinitionName(patternArg)).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Phase 6 — End-to-end: goto-definition, references, rename
  // ─────────────────────────────────────────────────────────────────────────
  describe('Phase 6 — analyzer integration', () => {
    const workspace = TestWorkspace.create().addFiles(
      TestFile.function('parse_date', [
        'function parse_date',
        '    if string match -rq \'(?<year>\\d{4})-(?<month>\\d{2})\' -- $argv[1]',
        '        echo "year=$year month=$month"',
        '    end',
        'end',
      ].join('\n')),
    ).initialize();

    // Line 2: `        echo "year=$year month=$month"`
    //          ↑0       ↑8   ↑13  ↑19↑20         ↑31↑32
    // `$year`'s name starts at character 20 (the `y` after the `$`).
    const YEAR_USAGE = { line: 2, character: 20 };

    it('goto-definition on $year resolves to the capture name inside the pattern', () => {
      const doc = workspace.getDocument('functions/parse_date.fish')!;
      analyzer.analyze(doc);

      const def = analyzer.getDefinition(doc, YEAR_USAGE);
      expect(def?.name).toBe('year');
      expect(def?.fishKind).toBe('STRING_REGEX');
      // capture lives on line 1 inside `(?<year>…)`
      expect(def?.selectionRange.start.line).toBe(1);
    });

    it('references on $year find both definition and usages', () => {
      const doc = workspace.getDocument('functions/parse_date.fish')!;
      analyzer.analyze(doc);

      const refs = analyzer.getReferences(doc, YEAR_USAGE);
      expect(refs.length).toBeGreaterThanOrEqual(2);
      // Def on line 1 + at least one $year expansion on line 2.
      const lines = refs.map(r => r.range.start.line);
      expect(lines).toContain(1);
      expect(lines).toContain(2);
    });

    it('rename rewrites both the capture name and every $var usage', () => {
      const doc = workspace.getDocument('functions/parse_date.fish')!;
      analyzer.analyze(doc);

      const edits = getRenames(doc, YEAR_USAGE, 'yr');
      const docEdits = edits.filter((e: FishRenameLocation) => e.uri === doc.uri);
      expect(docEdits.length).toBeGreaterThanOrEqual(2);
      expect(docEdits.every((e: FishRenameLocation) => e.newText === 'yr')).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Phase 7 — Cursor → symbol when cursor lands *inside* `(?<name>…)`
  //
  // Tree-sitter keeps the whole regex pattern as one string node, so
  // `wordAtPoint` without help returns null and the hover handler falls
  // through to the parent `string` command's man page. Phase 7 teaches
  // `wordAtPoint` to extract the capture name when the cursor is in range.
  // ─────────────────────────────────────────────────────────────────────────
  describe('Phase 7 — cursor on capture name resolves to the symbol', () => {
    const workspace = TestWorkspace.create().addFiles(
      TestFile.function('parse_date', [
        'function parse_date',
        '    if string match -rq \'(?<year>\\d{4})-(?<month>\\d{2})\' -- $argv[1]',
        '        echo "year=$year month=$month"',
        '    end',
        'end',
      ].join('\n')),
    ).initialize();

    // Line 1: `    if string match -rq '(?<year>\d{4})-(?<month>\d{2})' -- $argv[1]`
    //          ↑0   ↑4 ↑7    ↑14  ↑20 ↑24↑25↑28          ↑43
    //                                       ^^^^ year     ^^^^^ month
    // `year`'s name spans cols 28-31; `month`'s spans 43-47.
    const YEAR_DEF = { line: 1, character: 30 };  // middle of `year` in `(?<year>`
    const MONTH_DEF = { line: 1, character: 45 }; // middle of `month` in `(?<month>`

    it('wordAtPoint returns the capture name when cursor lands inside (?<name>...)', () => {
      const doc = workspace.getDocument('functions/parse_date.fish')!;
      analyzer.analyze(doc);

      expect(analyzer.wordAtPoint(doc.uri, YEAR_DEF.line, YEAR_DEF.character)).toBe('year');
      expect(analyzer.wordAtPoint(doc.uri, MONTH_DEF.line, MONTH_DEF.character)).toBe('month');
    });

    it('wordAtPoint still returns null when cursor is on a non-capture part of the pattern', () => {
      const doc = workspace.getDocument('functions/parse_date.fish')!;
      analyzer.analyze(doc);

      // col 33 sits on `\` of `\d{4}` — between the two captures, not a name.
      const word = analyzer.wordAtPoint(doc.uri, 1, 33);
      expect(word).not.toBe('year');
      expect(word).not.toBe('month');
    });

    it('goto-definition with cursor inside (?<year>…) resolves to the capture symbol', () => {
      const doc = workspace.getDocument('functions/parse_date.fish')!;
      analyzer.analyze(doc);

      const def = analyzer.getDefinition(doc, YEAR_DEF);
      expect(def?.name).toBe('year');
      expect(def?.fishKind).toBe('STRING_REGEX');
    });

    it('hover with cursor inside (?<year>…) returns the symbol hover, not the string manpage', () => {
      const doc = workspace.getDocument('functions/parse_date.fish')!;
      analyzer.analyze(doc);

      // analyzer.getHover only returns a hover when it found a symbol. With
      // Phase 7 wired, it'll return the capture symbol's `toHover()` content.
      // Without it, wordAtPoint returns null → getDefinition returns null →
      // getHover returns null, and the server's onHover falls through to the
      // `string` man page (the bug the user reported).
      const hover = analyzer.getHover(doc, YEAR_DEF);
      expect(hover).not.toBeNull();
      const contents = hover!.contents as { value: string; };
      expect(contents.value).toContain('year');
      // sanity: not the man page fallback
      expect(contents.value).not.toMatch(/manipulate.*strings/i);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Phase 8 — Lifetime (variable doesn't exist before the call)
  // ─────────────────────────────────────────────────────────────────────────
  describe('Phase 8 — capture lifetime', () => {
    it('$word before the string-match call does NOT resolve to the capture', () => {
      const doc = createFakeLspDocument(
        'functions/early.fish',
        [
          'function early',
          '    echo $word',                              // line 1: usage BEFORE def
          '    string match -r \'(?<word>\\w+)\' -- a',    // line 2: def
          '    echo $word',                              // line 3: usage AFTER def
          'end',
        ].join('\n'),
      );
      analyzer.analyze(doc);

      const before = analyzer.getDefinition(doc, { line: 1, character: 10 });
      const after = analyzer.getDefinition(doc, { line: 3, character: 10 });

      // After def must resolve; before def must not (or must resolve to nothing
      // local — depending on lifetime semantics this may be null).
      expect(after?.name).toBe('word');
      expect(before === null || before.name !== 'word').toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Phase 10 — Subcommand & flag matrix
  // ─────────────────────────────────────────────────────────────────────────
  describe('Phase 10 — subcommand and flag coverage', () => {
    it.each([
      ['match', 'string match -r \'(?<x>.)\' a'],
      ['replace', 'string replace -r \'(?<x>.)\' \'\$x\' a'],
      ['split', 'string split -r \'(?<x>.)\' a.b'],
    ])('produces a symbol for `%s`', (_sub, line) => {
      const doc = createFakeLspDocument('functions/sub.fish', line);
      const cmd = firstStringCommand(doc.getText());
      const symbols = processStringRegexCommand(doc, cmd);
      expect(symbols.map((s: FishSymbol) => s.name)).toEqual(['x']);
    });

    it('multiple captures in a single pattern produce multiple symbols', () => {
      const doc = createFakeLspDocument(
        'functions/multi.fish',
        'string match -r \'(?<a>.)(?<b>.)(?<c>.)\' xyz',
      );
      const symbols = processStringRegexCommand(doc, firstStringCommand(doc.getText()));
      expect(symbols.map((s: FishSymbol) => s.name)).toEqual(['a', 'b', 'c']);
    });

    it('nested captures: outer and inner both produce symbols', () => {
      const doc = createFakeLspDocument(
        'functions/nest.fish',
        'string match -r \'(?<outer>(?<inner>\\d+))\' 42',
      );
      const symbols = processStringRegexCommand(doc, firstStringCommand(doc.getText()));
      expect(symbols.map((s: FishSymbol) => s.name)).toEqual(['outer', 'inner']);
    });

    it('-q quiet flag still produces capture symbols', () => {
      const doc = createFakeLspDocument(
        'functions/q.fish',
        'string match -rq \'(?<x>.)\' a',
      );
      const symbols = processStringRegexCommand(doc, firstStringCommand(doc.getText()));
      expect(symbols).toHaveLength(1);
    });

    // ─────────────────────────────────────────────────────────────────────
    // `--` sentinel placement + long/short flag mixing.
    //
    // The sentinel matters for option parsing in two distinct positions:
    //   - BEFORE the regex flag → flag is a literal, no capture detection
    //     (covered in Phase 1 by `respects the `--` sentinel`).
    //   - AFTER the regex flag, BEFORE the pattern arg → option parsing
    //     stops, but the pattern arg is still the pattern. Capture detection
    //     MUST still fire.
    // We also exercise mixed long/short flag combinations to make sure
    // arbitrary flag order before the pattern is not a blocker.
    // ─────────────────────────────────────────────────────────────────────
    it('all-long flags with `--` AFTER the pattern still detects captures', () => {
      // `string match --regex --all --entire '(?<year>\d{4})' -- $argv[1]`
      const doc = createFakeLspDocument(
        'functions/long_after.fish',
        'string match --regex --all --entire \'(?<year>\\d{4})\' -- $argv[1]',
      );
      const symbols = processStringRegexCommand(doc, firstStringCommand(doc.getText()));
      expect(symbols.map((s: FishSymbol) => s.name)).toEqual(['year']);
    });

    it('all-long flags with `--` BETWEEN flags and pattern still detects captures', () => {
      // `string match --regex --all --entire -- '(?<year>\d{4})' $argv[1]`
      const doc = createFakeLspDocument(
        'functions/long_between.fish',
        'string match --regex --all --entire -- \'(?<year>\\d{4})\' $argv[1]',
      );
      const symbols = processStringRegexCommand(doc, firstStringCommand(doc.getText()));
      expect(symbols.map((s: FishSymbol) => s.name)).toEqual(['year']);
    });

    it('mixed short/long flags with `--` between flags and pattern still detects captures', () => {
      // `string replace -r --all -- '(?<year>\d{4})' $argv`
      const doc = createFakeLspDocument(
        `conf.d/${new Date().getMilliseconds()}.fish`,
        'string replace -r --all -- \'(?<year>\\d{4})\' $argv',
      );
      const symbols = processStringRegexCommand(doc, firstStringCommand(doc.getText()));
      expect(symbols.map((s: FishSymbol) => s.name)).toEqual(['year']);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Phase 8 — Hover content, --all list-ness, unused diagnostic
  // ─────────────────────────────────────────────────────────────────────────
  describe('Phase 8 — detail / diagnostics', () => {
    it('hover content includes the variable name, kind label, and the originating string command', () => {
      const doc = createFakeLspDocument(
        'functions/cap.fish',
        [
          'function cap',
          '    string match -r \'(?<year>\\d{4})\' -- $argv',
          '    echo $year',
          'end',
        ].join('\n'),
      );
      analyzer.analyze(doc);

      const sym = analyzer.getFlatDocumentSymbols(doc.uri).find((s: FishSymbol) => s.name === 'year')!;
      expect(sym).toBeDefined();
      const hover = sym.toHover();
      const value = (hover.contents as { value: string; }).value;

      // Bare-minimum hover shape: includes the variable name and a hint of
      // the originating regex (so users know WHERE the variable came from).
      expect(value).toContain('year');
      expect(value).toMatch(/string\s+match/);
    });

    it('--all/-a captures surface as list-valued in the detail', () => {
      const identifier = `all_caps_${new Date().getMilliseconds()}}`;
      const doc = createFakeLspDocument(
        `functions/${identifier}.fish`,
        [
          `function ${identifier}`,
          '    string match -ra \'(?<n>\\d+)\' -- "1 2 3"',
          '    for v in $n; echo $v; end',
          'end',
        ].join('\n'),
      );
      analyzer.analyze(doc);

      const sym = analyzer.getFlatDocumentSymbols(doc.uri).find((s: FishSymbol) => s.name === 'n')!;
      expect(sym).toBeDefined();
      // Either the detail or hover must hint at list/array semantics so the
      // user knows `$n` will hold every match, not just the first.
      const hover = (sym.toHover().contents as { value: string; }).value;
      expect(hover.toLowerCase()).toMatch(/list|array|--all/);
    });

    it('unused capture surfaces in allUnusedLocalReferences', () => {
      const doc = createFakeLspDocument(
        'functions/unused.fish',
        [
          'function unused',
          '    string match -r \'(?<dead>\\d+)\' -- $argv',
          '    echo "no usage of dead"',
          'end',
        ].join('\n'),
      );
      analyzer.analyze(doc);

      const unused = analyzer.allUnusedLocalReferences(doc);
      expect(unused.some((s: FishSymbol) => s.name === 'dead' && s.fishKind === 'STRING_REGEX')).toBe(true);
    });

    it('used capture is NOT flagged as unused', () => {
      const doc = createFakeLspDocument(
        'functions/used.fish',
        [
          'function used',
          '    string match -r \'(?<alive>\\d+)\' -- $argv',
          '    echo $alive',
          'end',
        ].join('\n'),
      );
      analyzer.analyze(doc);

      const unused = analyzer.allUnusedLocalReferences(doc);
      expect(unused.find((s: FishSymbol) => s.name === 'alive')).toBeUndefined();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Phase 9 — Rename starting *from* the capture name (cursor inside pattern)
  //
  // Phase 6's rename test starts the cursor on a `$year` usage. Phase 7
  // unlocks the cursor-on-def case for goto-def and hover — this asserts the
  // same path works for rename too.
  // ─────────────────────────────────────────────────────────────────────────
  describe('Phase 9 — rename from cursor on the capture definition', () => {
    const workspace = TestWorkspace.create().addFiles(
      TestFile.function('rename_from_def', [
        'function rename_from_def',
        '    if string match -rq \'(?<year>\\d{4})\' -- $argv[1]',
        '        echo $year',
        '    end',
        'end',
      ].join('\n')),
    ).initialize();

    // Cursor on the `e` of `year` inside `(?<year>` — col 29
    const CAPTURE_DEF_POS = { line: 1, character: 29 };

    it('renames the capture name AND every $year usage', () => {
      const doc = workspace.getDocument('functions/rename_from_def.fish')!;
      analyzer.analyze(doc);

      const edits = getRenames(doc, CAPTURE_DEF_POS, 'yr');
      const docEdits = edits.filter((e: FishRenameLocation) => e.uri === doc.uri);

      expect(docEdits.length).toBeGreaterThanOrEqual(2);
      expect(docEdits.every((e: FishRenameLocation) => e.newText === 'yr')).toBe(true);
      // One edit on line 1 (the (?<year> site), one on line 2 ($year usage).
      const lines = new Set(docEdits.map((e: FishRenameLocation) => e.range.start.line));
      expect(lines).toContain(1);
      expect(lines).toContain(2);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Phase 11 — End-to-end via the real LSP server
  //
  // Spins up FishServer, opens a buffer, and sends `textDocument/definition`
  // through the public handler path. If this passes, every cross-cutting piece
  // (analyzer, references, hover, scopes) is wired correctly behind the LSP
  // protocol — not just at the analyzer-API level.
  // ─────────────────────────────────────────────────────────────────────────
  describe('Phase 11 — LSP server smoke test', () => {
    let handle: TestServerHandle;
    const workspace = TestWorkspace.create().addFiles(
      TestFile.function('smoke', [
        'function smoke',
        '    if string match -rq \'(?<year>\\d{4})\' -- $argv[1]',
        '        echo $year',
        '    end',
        'end',
      ].join('\n')),
    ).initialize();

    beforeAll(async () => {
      handle = await createTestServer();
    });

    afterAll(async () => {
      await handle?.shutdown();
    });

    it('textDocument/definition on $year resolves to the (?<year>…) capture site', async () => {
      const doc = workspace.getDocument('functions/smoke.fish')!;
      expect(doc).toBeDefined();

      // $year usage on line 2: `        echo $year`
      //                                       ^---- col 14 = 'y' of $year
      const result = await handle.server.onDefinition({
        textDocument: { uri: doc.uri },
        position: { line: 2, character: 14 },
      });

      const locations = Array.isArray(result) ? result : result ? [result] : [];
      expect(locations.length).toBeGreaterThan(0);
      const target = locations[0]!;
      // Definition lives on line 1 inside `(?<year>...)`.
      expect(target.uri).toBe(doc.uri);
      expect(target.range.start.line).toBe(1);
    });
  });
});
