import { assert } from 'chai';
import { setLogger } from './helpers';
import { getFlagCommand, getFlagDocumentationString } from '../src/utils/flag-documentation';

const isLogging = false;
const logging = (...str: string[]) => {
  return isLogging ? console.log(str) : '';
};

setLogger();

describe('flag-documentation test suite', () => {
  it('set --local', async () => {
    const testStr = 'set --local';
    const res = await getFlagDocumentationString(testStr);
    const name = await getFlagCommand(testStr);
    logging('name', `'${name}'`);
    logging('res', res);

    expect(name).toEqual('set');
  });

  it('set -lx', async () => {
    const testStr = 'set -lx';
    const res = await getFlagDocumentationString(testStr);
    const name = await getFlagCommand(testStr);
    logging('name', `'${name}'`);
    logging('res', res);

    expect(name).toEqual('set');
  });

  it('if set -lx', async () => {
    const testStr = 'if set -lx';
    const res = await getFlagDocumentationString(testStr);
    const name = await getFlagCommand(testStr);
    logging('name', `'${name}'`);
    logging('res', res);

    expect(name).toEqual('set');
  });

  it('find -name ".git"', async () => {
    const testStr = 'find -name ".git"';
    const res = await getFlagDocumentationString(testStr);
    const name = await getFlagCommand(testStr);
    logging('name', `'${name}'`);
    logging('res', res);

    expect(name).toEqual('find');
  });

  it('string match -raq "(.*) $argv', async () => {
    const testStr = 'string match -raq "(.*) $argv';
    const res = await getFlagDocumentationString(testStr);
    const name = await getFlagCommand(testStr);
    logging('name', `'${name}'`);
    logging('res', res);

    expect(name).toEqual('string match');
  });
});
