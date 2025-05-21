import { md, MarkdownBuilder } from '../src/utils/markdown-builder';
import { setLogger } from './helpers';

setLogger();

describe('markdown-builder test suite', () => {
  it('simple test italic', () => {
    const value = md.italic('italic');
    expect(value).toBe('*italic*');
  });

  it('simple test bold', () => {
    const value = md.bold('bold');
    expect(value).toBe('**bold**');
  });

  it('simple test bold and italic', () => {
    const value = md.boldItalic('bold and italic');
    expect(value).toBe('***bold and italic***');
  });

  it('simple test separator', () => {
    const value = md.separator();
    expect(value).toBe('___');
  });

  it('simple test newline', () => {
    const value = md.newline();
    expect(value).toBe('  \n');
  });

  it('simple test blockquote', () => {
    const value = md.blockQuote('quoted string');
    expect(value).toBe('> quoted string');
  });

  it('simple test paragraph', () => {
    const value = md.p('paragraph', 'string');
    expect(value).toBe('paragraph string');
  });

  it('test markdown builder 1', () => {
    const built = new MarkdownBuilder()
      .appendMarkdown(md.bold('hello') + ' - ' + md.italic('world'))
      .appendNewline()
      .appendMarkdown(md.separator())
      .appendNewline()
      .appendMarkdown('here is a message to the world!')
      .toString();

    // console.log(built);
    expect(built).toBe([
      '**hello** - *world*',
      '___',
      'here is a message to the world!',
    ].join(md.newline()));
  });

  it('test markdown builder 2', () => {
    const built = new MarkdownBuilder()
      .fromMarkdown(
        [md.bold('hello'), '-', md.italic('world')],
        md.separator(),
        'here is a message to the world!',
      )
      .toString();

    // console.log(built);
    expect(built).toBe([
      '**hello** - *world*',
      '___',
      'here is a message to the world!',
    ].join('\n'));
  });

  it('test markdown builder 3', () => {
    const built = new MarkdownBuilder()
      .fromMarkdown([md.bold('use'), md.inlineCode('hello'), md.bold('to echo the message')])
      .appendNewline()
      .appendMarkdown(md.codeBlock('fish', [
        'function hello',
        '    echo hello world',
        'end',
      ].join('\n')))
      .toString();

    // console.log(built);
    expect(built).toBe([
      '**use** `hello` **to echo the message**  ',
      '```fish',
      'function hello',
      '    echo hello world',
      'end',
      '```',
    ].join('\n'));
  });
});
