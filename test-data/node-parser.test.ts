// import {initializeParser} from '../src/parser'
//import fish from 'tree-sitter-fish'
import { setLogger } from './helpers';
// import { initializeParser } from '../src/parser';
//@ts-ignore
import Parser from 'tree-sitter';

import Fish from '@esdmr/tree-sitter-fish/tree-sitter-fish.wasm';

setLogger();

// const file = path.join(__dirname,'..', 'node_modules','tree-sitter-fish','grammar.ts')
// console.log(file);
// const Fish = require(path.join(__dirname, '../node_modules/tree-sitter-fish'))

export class FishParser {
  private parser: Parser;

  constructor() {
    this.parser = new Parser();
    this.parser.setLanguage(Fish);
  }

  // private loadFishGrammar(): any {
  //   try {
  //     return require(path.join(
  //       __dirname,
  //       '..',
  //       'node_modules',
  //       'tree-sitter-fish'
  //     ));
  //   } catch (error) {
  //     console.error('Failed to load tree-sitter-fish grammar:', error);
  //     throw error;
  //   }
  // }
  //
  parse(code: string): Parser.Tree {
    return this.parser.parse(code);
  }

  // You can add more methods here as needed
}

describe(' node bindings fish-parser suite', () => {
  it('test-1', async () => {
    const tree = new FishParser().parse('string split \' \' -- "$argv"');
    console.log(tree.rootNode);
  });
});
