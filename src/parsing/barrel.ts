
import * as SetParser from './set';
import * as ReadParser from './read';
import * as ForParser from './for';
import * as ArgparseParser from './argparse';
import * as FunctionParser from './function';
import * as CompleteParser from './complete';
import * as OptionsParser from './options';
import * as SymbolParser from './symbol';

export const Parsers = {
  set: SetParser,
  read: ReadParser,
  for: ForParser,
  argparse: ArgparseParser,
  function: FunctionParser,
  complete: CompleteParser,
  options: OptionsParser,
  symbol: SymbolParser,
};

export { Option } from './options';

export const parsers = Object.keys(Parsers).map(key => Parsers[key as keyof typeof Parsers]);
