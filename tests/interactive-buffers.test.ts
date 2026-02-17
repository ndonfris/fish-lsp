import { TestWorkspace, TestFile } from './test-workspace-utils';
import { Analyzer } from '../src/analyze';
import { LspDocument } from '../src/document';
import { setLogger } from './helpers';
import { setupProcessEnvExecFile } from '../src/utils/process-env';

// test suite for `funced`, `edit_commandline_buffer`, and any other interactive
// command buffers that may be added in the future.
//
// These buffers have special behavior, such as not
// allowing renames of variables or functions defined within them, and
// this suite will ensure that this behavior is correctly implemented and maintained.
//
// Tests may include a variety of features for these buffers, such as:
// - confirming correct rename request behavior
// - references and definitions across all documents
// - diagnostics and code-actions related to the special behavior of these buffers
// - ensuring that the special behavior does not affect other documents or buffers
// - any other relevant features or edge cases that may arise from the unique nature of these interactive command buffers.

describe('Interactive Command Buffers (funced, edit_commandline_buffer, ...)', () => {
  const tw = TestWorkspace.create()
    .addFiles(
      TestFile.custom('/tmp/fish.HBob9J/command-line.fish',
        [
          'for i in (seq 1 10)',
          '   # make sure i does not allow renames in ~/.config/fish/*',
          'end',
        ].join('\n'),
      ),
      TestFile.custom('/tmp/fish.HBob9J/funced.fish',
        ['function foo',
          '   echo "foo"',
        ].join('\n'),
      ),
      TestFile.custom('/home/user/.config/fish/config.fish',
        [
          '',
          '# original i',
          'set -q i && echo $i',
          '',
          '# original functions',
          'function foo',
          '   echo "original foo"',
          'end',
          '',
          'function bar',
          '   echo "original bar"',
          'end',
          '',
          '# This is a comment',
          'function baz',
          '   echo "original baz"',
          'end',
        ].join('\n'),
      ),
      TestFile.custom('/home/user/.config/fish/functions/foo_foo.fish',
        [
          '# original functions',
          'function foo_foo',
          '   foo',
          '   echo "original foo"',
          '   set -q i && echo $i',
          'end',
        ].join('\n'),
      ),
    ).initialize();

  let cliDocument: LspDocument;
  let funcedDocument: LspDocument;
  let configDocument: LspDocument;
  let fooFooDocument: LspDocument;

  beforeAll(async () => {
    await Analyzer.initialize();
    await setupProcessEnvExecFile();
    setLogger();
    cliDocument = tw.find('/tmp/fish.HBob9J/command-line.fish')!;
    funcedDocument = tw.find('/tmp/fish.HBob9J/funced.fish')!;
    configDocument = tw.find('/home/user/.config/fish/config.fish')!;
    fooFooDocument = tw.find('/home/user/.config/fish/functions/foo_foo.fish')!;
  });

  it('confirm docs', async () => {
    expect(cliDocument).toBeDefined();
    expect(funcedDocument).toBeDefined();
    expect(configDocument).toBeDefined();
    expect(fooFooDocument).toBeDefined();
  });

  it('should not allow renames in command-line buffers', async () => {
    const doc = cliDocument;
    console.log({
      text: doc.getText(),
    });
  });
});
