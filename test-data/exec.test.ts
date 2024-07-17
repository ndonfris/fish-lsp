
import { setLogger } from './helpers';

import path from 'path';
import {
  execEscapedCommand,
  execCmd,
  execCompleteLine,
  execCompleteSpace,
  execCommandDocs,
  execCommandType,
} from '../src/utils/exec';

setLogger();

describe('src/utils/exec.ts tests', () => {
  it('execEscapedCommand', async () => {
    const output = await execEscapedCommand('pwd');
    const check = path.resolve(__dirname, '..');
    // const result = path.resolve(output.toString())
    // console.log("escaped:", output[0], '---', check);
    expect(output[0]).toEqual(check);
  });

  it('execCmd', async () => {
    const output = await execCmd('pwd');
    const check = path.resolve(__dirname, '..');
    // console.log('execCmd: ', output[0], '---', check);
    expect(output[0]).toEqual(check);
  });

  it('execCompleteLine', async () => {
    const output = await execCompleteLine('echo -');
    // console.log('line: ', output.length);
    expect(output.length).toEqual(4);
  });

  it('execCompleteSpace', async () => {
    const output = await execCompleteSpace('string ');
    // console.log('line: ', output.length);
    expect(output.length).toEqual(17);
  });

  it('execCommandDocs', async () => {
    const output = await execCommandDocs('end');
    // console.log('docs: ', output.split('\n').length);
    expect(output.split('\n').length).toBeGreaterThan(10);
  });

  it('execCommandType', async () => {
    const output = await execCommandType('end');
    // console.log('docs: ', output.split('\n').length);
    expect(output).toEqual('command');
  });
});
