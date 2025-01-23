import * as Parser from 'web-tree-sitter';
import { getChildNodes } from '../src/utils/tree-sitter';
import { isIfStatement } from '../src/utils/node-types';
import { convertIfToCombinersString } from '../src/code-actions/combiner';
import { setLogger } from './helpers';
import { initializeParser } from '../src/parser';
import { findReturnNodes, getReturnStatusValue } from '../src/code-lens';

let parser: Parser;

describe('Code Action Tests', () => {
  setLogger();
  beforeAll(async () => {
    parser = await initializeParser();
  });
  beforeEach(async () => {
    parser.reset();
  });

  describe('Refactor Combiner Tests', () => {
    const tests = [
      {
        name: 'Convert Refactor `if`',
        input: `
      if test -f file
          echo "file exists"
      end`,
        expected: `test -f file
and echo "file exists"`,
      },
      {
        name: 'Convert Refactor `if` with `else`',
        input: `
      if test -f file
          echo "file exists"
      else
          echo "file does not exist"
          # comment
          echo 'exiting'
      end`,
        expected: `test -f file
and echo "file exists"

or echo "file does not exist"
# comment
and echo 'exiting'`,
      },
      {
        name: 'Convert Refactor `if` with `else if`',
        input: `
      if test -f file
          echo "file exists"
      else if test -d file
          echo "file is a directory" &> /dev/null
      end`,
        expected: `test -f file
and echo "file exists"

or test -d file
and echo "file is a directory" &> /dev/null`,
      },
      {
        name: 'Convert Refactor `if` with `else if` and `else`',
        input: `
      if test -f file || test -e file
          echo "file exists"
      else if test -d file
          echo "file is a directory"
      else
        echo "file does not exist"
      end`,
        expected: `test -f file || test -e file
and echo "file exists"

or test -d file
and echo "file is a directory"

or echo "file does not exist"`,
      },
    ];

    tests.forEach(({ name, input, expected }) => {
      it(name, async () => {
        const tree = parser.parse(input);
        const root = tree.rootNode;
        const node = getChildNodes(root).find(n => isIfStatement(n));

        if (!node) fail();

        const combiner = convertIfToCombinersString(node);

        // console.log('-'.repeat(50));
        // console.log(combiner);
        // console.log('-'.repeat(50));

        expect(combiner).toBe(expected);
      });
    });
  });

  describe('Refactor Function Tests', () => {
    it.only('Convert Refactor Function', async () => {
      const input = 'return 2';
      const rootNode = parser.parse(input).rootNode;
      const rets = findReturnNodes(rootNode);
      console.log(rets.map(r => r.text));

      rets.forEach(ret => {
        console.log(getReturnStatusValue(ret));
      });
    });
  });
});
