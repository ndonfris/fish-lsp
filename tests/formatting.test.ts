import { formatDocumentContent, formatDocumentWithIndentComments } from '../src/formatting';
import { setLogger } from './helpers';
import { TestWorkspace, TestFile } from './test-workspace-utils';

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

describe('@fish_indent toggle formatting tests', () => {
  describe('basic', () => {
    const workspace = TestWorkspace.createSingle(`

echo "should be formatted"
# @fish_indent: off
echo "should not be formatted"
    echo "still not formatted"
# @fish_indent: on  
echo "should be formatted again"`).initialize();
    it('should skip formatting when @fish_indent: off is used', async () => {
      const doc = workspace.focusedDocument!;
      const result = await formatDocumentWithIndentComments(doc);

      const lines = result.split('\n');

      // First formatted line should be formatted (accounting for leading empty lines)
      expect(lines[2]).toBe('echo "should be formatted"');

      // Lines within off/on block should remain unformatted
      expect(lines[4]).toBe('echo "should not be formatted"'); // Not indented
      expect(lines[5]).toBe('    echo "still not formatted"'); // Original indentation preserved

      // Last line should be formatted (no change in this case)
      expect(lines[7]).toBe('echo "should be formatted again"');
    });
  });

  describe('no comments', () => {
    const workspace = TestWorkspace.createSingle(`function test
echo "hello"
if test $status -eq 0
echo "success"
end
end`).initialize();

    it('should format entire document when no @fish_indent comments present', async () => {
      const doc = workspace.focusedDocument!;
      const result = await formatDocumentWithIndentComments(doc);

      expect(result).toContain('    echo hello'); // Should be indented
      expect(result).toContain('        echo success'); // Should be double indented
    });
  });

  describe('disabled via comment', () => {
    const workspace = TestWorkspace.createSingle(`


# @fish_indent: off
function test
echo "unformatted"
end
# @fish_indent: on
function test2
echo "formatted"
end`).initialize();

    it('should handle document starting with @fish_indent: off', async () => {
      const doc = workspace.focusedDocument!;
      const result = await formatDocumentWithIndentComments(doc);

      const lines = result.split('\n');

      // Unformatted section (accounting for leading empty lines)
      expect(lines[5]).toBe('echo "unformatted"'); // Should not be indented

      // Formatted section
      expect(lines[9]).toBe('    echo formatted'); // Should be indented
    });
  });

  describe('EOF comment', () => {
    const workspace = TestWorkspace.createSingle(`function test
echo "formatted"
end
# @fish_indent: off
function test2
echo "unformatted"
end`).initialize();

    it('should handle document ending with @fish_indent: off', async () => {
      const doc = workspace.focusedDocument!;
      const result = await formatDocumentWithIndentComments(doc);

      const lines = result.split('\n');

      // Formatted section
      expect(lines[1]).toBe('    echo formatted'); // Should be indented

      // Unformatted section
      expect(lines[5]).toBe('echo "unformatted"'); // Should not be indented
    });
  });

  describe('multiple on/off pairs', () => {
    const workspace = TestWorkspace.create().addFiles(
      TestFile.script('pair_1.fish', `echo "line 0 - format"
echo "line 1 - format"
# @fish_indent: off
echo "line 3 - no format"
echo "line 4 - no format"
# @fish_indent: on
function test
echo "line 7 - format"
end
# @fish_indent: off
echo "line 10 - no format"
# @fish_indent: on
echo "line 12 - format"`),
      TestFile.script('pair_2.fish', `# @fish_indent: off
echo "line 0 - no format"
echo "line 1 - no format"
# @fish_indent: on
echo "line 3 - format"
# @fish_indent: off
echo "line 5 - no format"
echo "line 6 - no format"
# @fish_indent: on`),
      TestFile.script('no_pair.fish', `function test
echo "formatted"
end
# @fish_indent
function test2
echo "also formatted"  
end`),
    ).initialize();

    it('should handle multiple @fish_indent off/on pairs', async () => {
      const doc = workspace.getDocument('pair_1.fish')!;
      const result = await formatDocumentWithIndentComments(doc);

      const lines = result.split('\n');

      // First formatted section
      expect(lines[0]).toBe('echo "line 0 - format"');
      expect(lines[1]).toBe('echo "line 1 - format"');

      // First unformatted section
      expect(lines[3]).toBe('echo "line 3 - no format"');
      expect(lines[4]).toBe('echo "line 4 - no format"');

      // Second formatted section
      expect(lines[7]).toBe('    echo "line 7 - format"'); // Should be indented inside function

      // Second unformatted section
      expect(lines[10]).toBe('echo "line 10 - no format"');

      // Final formatted section
      expect(lines[12]).toBe('echo "line 12 - format"');
    });

    it('should handle @fish_indent without explicit on/off value', async () => {
      const doc = workspace.getDocument('no_pair.fish')!;
      const result = await formatDocumentWithIndentComments(doc);

      const lines = result.split('\n');

      // Both sections should be formatted since @fish_indent defaults to "on"
      expect(lines[1]).toBe('    echo formatted');
      expect(lines[5]).toBe('    echo "also formatted"');
    });
  });
});
