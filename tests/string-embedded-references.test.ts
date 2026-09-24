import { Location, Position } from 'vscode-languageserver';
import { analyzer } from '../src/analyze';
import { LspDocument } from '../src/document';
import { createFakeLspDocument, createTestServer, TestServerHandle } from './helpers';

/**
 * `complete -a/-n` values and alias bodies are fish code run later, so the names
 * inside them are real references even in single quotes, where tree-sitter keeps
 * the whole value as one string node.
 */
describe('references inside strings fish evaluates later', () => {
  let handle: TestServerHandle;

  beforeAll(async () => {
    handle = await createTestServer();
  });

  afterAll(async () => {
    await handle?.shutdown();
  });

  const lines = [
    'set -l variable 1',
    'set -l sed_replace {1,2,3}',
    'complete -c foo -n \'__fish_seen_subcommand_from bar && not __fish_contains_opt -s n name\' -s n -l name -d "n/name" -kxa \'jack jill adam nemo $variable $sed_replace\'',
    'complete -c foo -n \'test -n "$variable"; and set -q sed_replace\'',
    'alias ff=\'echo $sed_replace\'',
    'function foo -w=\'ff\'',
    'end',
  ];

  let doc: LspDocument;
  beforeAll(() => {
    doc = createFakeLspDocument('/tmp/string-embedded-references.fish', lines.join('\n'));
    analyzer.analyze(doc);
  });

  /** the position of the `nth` occurrence of `text` on `line`, `offset` characters in */
  const at = (line: number, text: string, nth = 0, offset = 1): Position => {
    let character = -1;
    for (let i = 0; i <= nth; i++) character = lines[line]!.indexOf(text, character + 1);
    expect(character).toBeGreaterThanOrEqual(0);
    return { line, character: character + offset };
  };
  const texts = (locations: Location[]) => locations.map(loc => `${loc.range.start.line}:${doc.getText(loc.range)}`);

  it.each([
    ['$variable in `complete -kxa \'…\'`', 2, '$variable', 'variable', 0],
    ['$sed_replace in `complete -kxa \'…\'`', 2, '$sed_replace', 'sed_replace', 1],
    ['$variable in `complete -n \'…"$variable"…\'`', 3, '$variable', 'variable', 0],
    ['$sed_replace in `alias ff=\'…\'`', 4, '$sed_replace', 'sed_replace', 1],
  ])('go-to-definition: %s', (_, line, text, name, defLine) => {
    const symbol = analyzer.getDefinition(doc, at(line, text, 0, 2));
    expect(symbol?.name).toBe(name);
    expect(symbol?.selectionRange.start.line).toBe(defLine);
  });

  it('go-to-definition: `ff` in `function foo -w=\'ff\'`', () => {
    const symbol = analyzer.getDefinition(doc, at(5, 'ff'));
    expect(symbol?.name).toBe('ff');
    expect(symbol?.selectionRange.start.line).toBe(4);
  });

  it('references of `variable` include the uses inside strings', () => {
    const refs = analyzer.getReferences(doc, at(0, 'variable'));
    expect(texts(refs).sort()).toEqual(['0:variable', '2:variable', '3:variable'].sort());
  });

  it('references of `sed_replace` include the uses inside strings', () => {
    const refs = analyzer.getReferences(doc, at(1, 'sed_replace'));
    expect(texts(refs).sort()).toEqual(['1:sed_replace', '2:sed_replace', '4:sed_replace'].sort());
  });

  it('references of `ff` include `function foo -w=\'ff\'`', () => {
    const refs = analyzer.getReferences(doc, at(4, 'ff'));
    expect(texts(refs).sort()).toEqual(['4:ff', '5:ff'].sort());
  });

  describe('backslashes before `$` in a string fish reads twice', () => {
    // Parsing the line turns `\\` into `\` inside single quotes and keeps any other
    // `\`; evaluating the result then escapes `$` after an odd number of them.
    it.each([
      ['\\$v', false], // `\$v` → literal
      ['\\\\$v', false], // `\\$v` → `\$v` → literal
      ['\\\\\\$v', true], // `\\\$v` → `\\$v` → `\` then `$v`
      ['\\\\\\\\$v', true], // `\\\\$v` → `\\$v` → `\` then `$v`
      ['\\\\\\\\\\$v', false], // `\\\\\$v` → `\\\$v` → literal
    ])('`complete -a \'%s\'` references `v`: %s', (typed, expected) => {
      const text = `set -l v 1\ncomplete -c foo -a '${typed}'`;
      const escapes = createFakeLspDocument('/tmp/string-embedded-escapes.fish', text);
      analyzer.analyze(escapes);
      const refs = analyzer.getReferences(escapes, { line: 0, character: 7 });
      expect(refs.some(ref => ref.range.start.line === 1)).toBe(expected);
    });
  });

  describe('argparse \'n/name=!…\' validation scripts', () => {
    const script = [
      'function argparse_validation',
      '    argparse \'n/name=!_validate_int --min 0 --max 99 $_flag_name\' \'v/value=!test -n "$_flag_value$_argparse_cmd"\' -- $argv',
      '    echo $_flag_name',
      'end',
    ];
    let validation: LspDocument;
    beforeAll(() => {
      validation = createFakeLspDocument('/tmp/argparse-validation.fish', script.join('\n'));
      analyzer.analyze(validation);
    });
    const pos = (line: number, text: string, offset = 1): Position => ({ line, character: script[line]!.indexOf(text) + offset });

    it('renaming the flag from its spec still works', () => {
      expect(handle.server.onPrepareRename({ textDocument: { uri: validation.uri }, position: pos(1, 'n/name', 3) }))
        .toMatchObject({ placeholder: 'name' });
    });

    it('hover on `_validate_int` describes the function', async () => {
      const hover = await handle.server.onHover({ textDocument: { uri: validation.uri }, position: pos(1, '_validate_int') });
      expect(JSON.stringify(hover?.contents ?? '')).toContain('_validate_int');
      expect(JSON.stringify(hover?.contents ?? '')).not.toContain('ARGPARSE(1)');
    });

    it.each(['$_flag_name', '$_flag_value', '$_argparse_cmd'])('%s in the script resolves to no symbol and cannot be renamed', (text) => {
      const position = pos(1, text, 2);
      expect(analyzer.getDefinition(validation, position)).toBeFalsy();
      const prepare = () => handle.server.onPrepareRename({ textDocument: { uri: validation.uri }, position });
      // refused either way: no range, or the read-only error
      let result: unknown = null;
      try {
        result = prepare();
      } catch {
        result = null;
      }
      expect(result).toBeNull();
    });

    it.each(['$_flag_name', '$_flag_value', '$_argparse_cmd'])('hover on %s in the script documents it', async (text) => {
      const hover = await handle.server.onHover({ textDocument: { uri: validation.uri }, position: pos(1, text, 2) });
      const contents = JSON.stringify(hover?.contents ?? '');
      expect(contents).toContain(`(**variable**) \`${text.slice(1)}\``);
      expect(contents).toContain('flag validation script');
      expect(contents).not.toContain('ARGPARSE(1)');
    });

    it('references of the `n/name` flag skip `$_flag_name` in the script', () => {
      const refs = analyzer.getReferences(validation, pos(2, '_flag_name'));
      expect(refs.length).toBeGreaterThan(0);
      expect(refs.every(ref => ref.range.start.line !== 1 || ref.range.start.character < script[1]!.indexOf('!'))).toBe(true);
    });
  });

  it('hover on `ff` in `function foo -w=\'ff\'` shows the alias, not the word\'s expansion', async () => {
    const hover = await handle.server.onHover({ textDocument: { uri: doc.uri }, position: at(5, 'ff') });
    const contents = JSON.stringify(hover?.contents ?? '');
    expect(contents).toContain('(**alias**)');
    expect(contents).not.toContain('-w=');
  });

  it.each([
    [2, '$sed_replace', 0],
    [4, '$sed_replace', 0],
  ])('hover on line %i %s shows the variable', async (line, text, nth) => {
    const hover = await handle.server.onHover({ textDocument: { uri: doc.uri }, position: at(line, text, nth, 2) });
    expect(JSON.stringify(hover?.contents ?? '')).toContain('sed_replace');
    expect(JSON.stringify(hover?.contents ?? '')).toContain('{1,2,3}');
  });
});
