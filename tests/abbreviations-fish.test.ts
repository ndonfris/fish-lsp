import { execFileSync } from 'child_process';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import Parser from 'web-tree-sitter';
import { abbreviationsFromSource, FishAbbreviation } from '../src/completions/abbreviations';
import { initializeParser } from '../src/parser';

/**
 * Compares the static abbreviation parser with Fish's own `abbr --show` output.
 * Fish is invoked with a private HOME so the user's abbreviations are not read
 * or modified.
 */
let parser: Parser;

beforeAll(async () => {
  parser = await initializeParser();
});

type StoredAbbreviation = Omit<FishAbbreviation, 'source'>;

function stored(abbr: FishAbbreviation): StoredAbbreviation {
  return {
    name: abbr.name,
    expansion: abbr.expansion,
    position: abbr.position,
    commands: abbr.commands,
    ...abbr.cursorMarker !== undefined ? { cursorMarker: abbr.cursorMarker } : {},
  };
}

function fishShow(script: string): string {
  const home = mkdtempSync(join(tmpdir(), 'fish-abbr-home-'));
  return execFileSync('fish', ['--no-config', '-c', `${script}\nabbr --show`], {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH ?? '',
      HOME: home,
      XDG_CONFIG_HOME: join(home, '.config'),
      XDG_DATA_HOME: join(home, '.local', 'share'),
      LANG: 'C.UTF-8',
    },
  });
}

function fromFish(script: string): StoredAbbreviation[] {
  return abbreviationsFromSource(fishShow(script), parser).map(stored);
}

function fromSource(script: string): StoredAbbreviation[] {
  return abbreviationsFromSource(script, parser).map(stored);
}

describe('abbreviations match fish --show', () => {
  it.each([
    ['basic add', 'abbr --add ga \'git add\''],
    ['shorthand and several words', 'abbr -a ll ls -l'],
    ['flags after the expansion starts', 'abbr -a e emacs -nw'],
    ['default cursor marker', 'abbr --add gc --set-cursor \'git commit -m "%"\''],
    ['explicit cursor marker', 'abbr -a gco --set-cursor=% \'git checkout %\''],
    ['custom cursor marker', 'abbr -a x --set-cursor=! \'echo ! and !\''],
    ['anywhere', 'abbr -a gs --position anywhere \'git status\''],
    ['one command', 'abbr --add st --command git status'],
    ['several commands', 'abbr -a co --command git --command hg checkout'],
    ['brace of commands', 'abbr --command={git,hg} co checkout'],
    ['quoted dollar, brace, and backslash', 'abbr -a p \'echo $foo } \\\\\''],
    ['double quoted escapes', 'abbr -a q "echo \\"quote\\" \\\\backslash"'],
    ['unquoted hex and newline escapes', 'abbr -a p echo\\x41\\nfoo'],
    ['brace expansion of the expansion', 'abbr -a p echo{a,b}'],
    ['escaped braces stay literal', 'abbr -a p echo\\{a,b\\}'],
    ['rename refuses an existing name', 'abbr -a a one\nabbr -a b two\nabbr --rename a b'],
    ['last definition wins', 'abbr -a ga \'git add\'\nabbr -a ga \'git add -A\''],
    ['same name, different commands', 'abbr -a st --command git status\nabbr -a st --command hg summary'],
    ['erase', 'abbr -a ga \'git add\'\nabbr --erase ga'],
    ['rename', 'abbr -a ga \'git add\'\nabbr --rename ga gaa'],
    ['erase one command scope', 'abbr -a st --command git status\nabbr -a st --command hg summary\nabbr --erase --command git st'],
  ])('%s', (_label, script) => {
    expect(fromSource(script)).toEqual(fromFish(script));
  });

  it('agrees that an uncalled function does not define an abbreviation', () => {
    const script = [
      'abbr -a ga \'git add\'',
      'function never_called',
      '    abbr -a gb \'git branch\'',
      'end',
    ].join('\n');
    expect(fromSource(script)).toEqual(fromFish(script));
    expect(fromFish(script).map(abbr => abbr.name)).toEqual(['ga']);
  });

  it('keeps the branch Fish actually ran, which a static parse cannot see', () => {
    const script = [
      'if true',
      '    abbr -a x from-if',
      'else',
      '    abbr -a x from-else',
      'end',
    ].join('\n');
    expect(fromFish(script).map(abbr => abbr.expansion)).toEqual(['from-if']);
    expect(fromSource(script).map(abbr => abbr.expansion)).toEqual(['from-else']);
  });
});
