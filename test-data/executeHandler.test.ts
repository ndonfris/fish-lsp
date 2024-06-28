
import { exec } from 'child_process';
import { promisify } from 'util';
import { buildOutput, execEntireBuffer, sourceFishBuffer, FishThemeDump, showCurrentTheme } from '../src/executeHandler';
import { setLogger } from './helpers';
import { execCmd } from '../src/utils/exec';
import { join } from 'path';
import { writeFileSync } from 'fs';
import { SyncFileHelper } from '../src/utils/fileOperations';

const execAsync = promisify(exec);

let content = [
  'function foo \\',
  '           --argument-names a b c',
  '      echo "\\$a:$a"',
  '      echo "\\$b:$b"',
  '      echo "\\$c:$c"',
  'end',
  'foo 1 2 3',
].join('\n');

// Define the file path
let tmpBuff: string = join('/tmp', 'foo.fish');

setLogger(
  async () => {
    tmpBuff = join('/tmp', 'foo.fish');
  },
);

describe('executeHandler tests', () => {
  //  it('should find the longest line in a given set of strings', () => {
  //   const longestLine = findLongestLine('short line', 'this is the longest line', 'medium line');
  //   expect(longestLine).toBe('this is the longest line');
  // });

  it('format message', async () => {
    const line = 'echo a b c d | string match -e \'b\'';
    const inputLine = `fish -c '${line}'`;
    const output = (await execCmd(inputLine)).join('\n');

    const result = buildOutput(line, 'stdout:', output);

    // console.log({ formatOutput: output });
    expect(output).toBe('a b c d');
  }, 10000);

  it('format tmp buffer message', async () => {
    // Write the longest line to the file
    SyncFileHelper.write(tmpBuff, content, 'utf8');
    const output = await execEntireBuffer(tmpBuff);
    // console.log({ entireBuff: output });
    expect(output).toMatchObject({
      message: '><(((°> executing file:\n' +
        '        /tmp/foo.fish\n' +
        '--------------------------------------------------\n' +
        '$a:1\n' +
        '$b:2\n' +
        '$c:3\n' +
        '--------------------------------------------------\n' +
        '$status: 0\n',
      kind: 'info',
    });
  }, 10000);

  it('source file execution', async () => {
    // const parser = await initializeParser();
    /**
      * Removes function call
      */
    content = content.split('\n').slice(0, -1).join('\n').toString();

    writeFileSync(tmpBuff, content, 'utf8');

    const result = await sourceFishBuffer(tmpBuff);
    // console.log({ srcBuff: result });
    expect(result).toBe(
      '><(((°> sourcing file:\n' +
    '        /tmp/foo.fish\n' +
    '--------------------------------------------------\n' +
    '$status: 0\n');
  }, 10000);

  it('dump theme variables', async () => {
    content = '# I want to make a theme\n';

    SyncFileHelper.create(tmpBuff);
    SyncFileHelper.write(tmpBuff, content);

    const nonStandardThemeContent = await FishThemeDump();
    const functionTheme = SyncFileHelper.convertTextToFishFunction(tmpBuff, nonStandardThemeContent.join('\n'));

    // console.log(functionTheme);
    expect(functionTheme.uri).toBe('file:///tmp/foo.fish');
    expect(functionTheme.getText()).toBeTruthy();
  }, 10000);

  it('should source a Fish buffer and return the output message', async () => {
    const result = await sourceFishBuffer(tmpBuff);
    expect(result).toEqual(expect.any(String));
  }, 10000);

  it('should show the current theme and append it to the buffer file', async () => {
    const result = await showCurrentTheme(tmpBuff);
    expect(result).toEqual({
      message:  '><(((°> appended theme variables to end of file',
      kind: 'info',
    });
  }, 10000);
});
