import { BaseCmd, BuiltinCommandWithSubcmds } from '../src/parsing/builtins/util';
import { Option } from '../src/parsing/options';
import { setLogger } from './helpers';

describe('test base', () => {
  setLogger();
  const pathCmd = BuiltinCommandWithSubcmds.create(
    'path',
    BaseCmd.create(
      'resolve',
      Option.create('-h', '--help'),
      Option.create('-q', '--quiet'),
    ),
    BaseCmd.create(
      'filter',
      Option.create('-t', '--type').withValue(),
      Option.create('-h', '--help'),
    ),
    {
      name: 'other',
      flags: [Option.create('-h', '--help'), ['-h']],
    },
    [
      'type',
      Option.create('-h', '--help'),
      ['-f'],
      ['--find'],
    ],
  );

  it('show', () => {
    console.log(pathCmd.logObj());
  });
});
