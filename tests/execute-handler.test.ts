import { buildOutput, execEntireBuffer, sourceFishBuffer, FishThemeDump, showCurrentTheme } from '../src/execute-handler';
import { setLogger } from './helpers';
import { execCmd } from '../src/utils/exec';
import { join } from 'path';
import { readFileSync } from 'fs';
import TestWorkspace, { TestFile } from './test-workspace-utils';
import { pathToUri } from '../src/utils/translation';
import { SyncFileHelper } from '../src/utils/file-operations';

const content = [
  'function foo \\',
  '           --argument-names a b c',
  '      echo "\\$a:$a"',
  '      echo "\\$b:$b"',
  '      echo "\\$c:$c"',
  'end',
  'foo 1 2 3',
].join('\n');

setLogger();

describe('executeHandler tests', () => {
  const sourceContent = content.split('\n').slice(0, -1).join('\n');
  const workspace = TestWorkspace.create()
    .addFiles(
      TestFile.custom('foo.fish', content),
      TestFile.custom('source.fish', sourceContent),
      TestFile.custom('theme.fish', '# I want to make a theme\n'),
    ).initializeFiles();

  const bufferPath = (name: string) => join(workspace.path, name);
  const separator = (filePath: string) => '-'.repeat(Math.max(50, 8 + filePath.length));

  it('format message', async () => {
    const line = 'echo a b c d | string match -e \'b\'';
    const inputLine = `fish -c '${line}'`;
    const output = (await execCmd(inputLine)).join('\n');

    const result = buildOutput(line, 'stdout:', output);

    // console.log({ formatOutput: output });
    expect(output).toBe('a b c d');
  }, 10000);

  it('format tmp buffer message', async () => {
    const tmpBuff = bufferPath('foo.fish');
    const output = await execEntireBuffer(tmpBuff);
    // console.log({ entireBuff: output });
    expect(output).toMatchObject({
      message: '><(((°> executing file:\n' +
        `        ${tmpBuff}\n` +
        `${separator(tmpBuff)}\n` +
        '$a:1\n' +
        '$b:2\n' +
        '$c:3\n' +
        `${separator(tmpBuff)}\n` +
        '$status: 0\n',
      kind: 'info',
    });
  }, 30000);

  it('source file execution', async () => {
    const tmpBuff = bufferPath('source.fish');

    const result = await sourceFishBuffer(tmpBuff);
    // console.log({ srcBuff: result });
    expect(result).toBe(
      '><(((°> sourcing file:\n' +
    `        ${tmpBuff}\n` +
    `${separator(tmpBuff)}\n` +
    '$status: 0\n');
  }, 10000);

  it('dump theme variables', async () => {
    const tmpBuff = bufferPath('theme.fish');

    const nonStandardThemeContent = await FishThemeDump();
    const functionTheme = SyncFileHelper.convertTextToFishFunction(tmpBuff, nonStandardThemeContent.join('\n'));

    // console.log(functionTheme);
    expect(functionTheme.uri).toBe(pathToUri(tmpBuff));
    expect(functionTheme.getText()).toBeTruthy();
  }, 10000);

  it('should source a Fish buffer and return the output message', async () => {
    const tmpBuff = bufferPath('source.fish');
    const result = await sourceFishBuffer(tmpBuff);
    expect(result).toEqual(expect.any(String));
  });

  it('should show the current theme and append it to the buffer file', async () => {
    const tmpBuff = bufferPath('theme.fish');
    const before = readFileSync(tmpBuff, 'utf8');
    const result = await showCurrentTheme(tmpBuff);
    const after = readFileSync(tmpBuff, 'utf8');
    expect(after.startsWith(before)).toBe(true);
    expect(after.length).toBeGreaterThan(before.length);
    expect(result).toEqual({
      message:  '><(((°> appended theme variables to end of file',
      kind: 'info',
    });
  });
});
