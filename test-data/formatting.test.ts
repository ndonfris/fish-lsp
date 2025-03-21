import { formatDocumentContent } from '../src/formatting';
import { setLogger } from './helpers';

setLogger();

/**
  *  For logging a formatted output string, and using it as a snapshot later in a test
  *
  *  outputs a string for the:
  *     `expect(result).toBe([ HERE ].join('\n').trim())`
  */
function helperOutputFormattedString(input: string) {
  const arr = input.split('\n');
  arr.forEach((line: string, index: number) => {
    if (index === 0) {
      console.log(`[\'${line}\',`);
    } else if (index === arr.length - 1) {
      console.log(`\'${line}\'].join(\'\\n\')`);
    } else if (index < arr.length - 1) {
      console.log(`\'${line}\',`);
    }
  });
}

describe('formatting tests', () => {
  it('formatting no change', async () => {
    const input = 'set -gx PATH ~/.config/fish/';
    const result = (await formatDocumentContent(input)).trim();
    expect(result).toBe(input);
  });

  it('formatting function', async () => {
    const input: string = [
      'function a',
      'if set -q _some_value',
      'echo "_some_value is set: $_some_value"',
      'end',
      'end',
    ].join('\n');
    const result = await formatDocumentContent(input);
    expect(result).toBe([
      'function a',
      '    if set -q _some_value',
      '        echo "_some_value is set: $_some_value"',
      '    end',
      'end',
      '',
    ].join('\n'));
  });

  /**
   * the formatter always formats to spaces of size 4
   */
  it('formatting if statement', async () => {
    const input: string = [
      'if test $status -eq 0',
      ' echo yes',
      'else if test $status -eq 1',
      'echo no',
      'else',
      ' echo maybe',
      'end',
    ].join('\n').trim();
    const result = (await formatDocumentContent(input)).trim();
    expect(result).toBe([
      '',
      'if test $status -eq 0',
      '    echo yes',
      'else if test $status -eq 1',
      '    echo no',
      'else',
      '    echo maybe',
      'end',
    ].join('\n').trim());
  });

  it('formatting switch case', async () => {
    const input: string = [
      'switch "$argv"',
      'case \'y\' \'Y\' \'\'',
      '  return 0',
      'case \'n\' \'N\'',
      ' return 1',
      'case \'*\'',
      '     return 2',
      'end',
    ].join('\n').trim();
    const result = (await formatDocumentContent(input)).trim();
    // helperOutputFormattedString(result)
    expect(result).toBe([
      'switch "$argv"',
      '    case y Y \'\'',
      '        return 0',
      '    case n N',
      '        return 1',
      '    case \'*\'',
      '        return 2',
      'end',
    ].join('\n').trim());
  });

  /**
   * Does not add 'end' tokens
   *           &&
   * NO error when unbalanced 'end' tokens
   */
  it('for loop single line', async () => {
    const input = 'for i in (seq 1 10); echo $i; ';
    const result = (await formatDocumentContent(input)).trim();
    expect(result).toBe([
      'for i in (seq 1 10)',
      'echo $i',
    ].join('\n').trim());
  });

  /**
   * formatter removes ';'
   */
  it('for loop multi line', async () => {
    const input = [
      'for i in (seq 1 10);',
      'echo $i; ',
      'end',
    ].join('\n').trim();
    console.log();
    // fish_indent now breaks lines with ';' into '\n\n'
    const result = (await formatDocumentContent(input)).trim();
    console.log({
      'for loop multi line': '`' + result + '`',
      input: '`' + input + '`',
    });
    expect(result).toBeTruthy();
    expect(result).toBe([
      'for i in (seq 1 10)',
      '',
      '    echo $i',
      '',
      'end',
    ].join('\n').trim());
    // expect(result).toBe([
    //   'for i in (seq 1 10)',
    //   '    echo $i',
    //   'end',
    // ].join('\n').trim());
  });
});
