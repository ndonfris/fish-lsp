import { setLogger } from './helpers';
import { extractManPageSection } from '../src/hover';
import { execCommandDocs } from '../src/utils/exec';

setLogger();

describe('extractManPageSection()', () => {
  describe('indented entry style (status)', () => {
    let statusManPage: string;

    beforeAll(async () => {
      statusManPage = await execCommandDocs('status');
    });

    it('extracts `is-full-job-control` section', () => {
      const section = extractManPageSection(statusManPage, 'is-full-job-control');
      expect(section).not.toBeNull();
      expect(section).toContain('is-full-job-control');
      expect(section).toContain('Returns 0 if full job control is enabled');
    });

    it('extracts `is-login` section with flag aliases', () => {
      const section = extractManPageSection(statusManPage, 'is-login');
      expect(section).not.toBeNull();
      expect(section).toContain('is-login');
      expect(section).toContain('--is-login');
    });

    it('extracts `current-command` section', () => {
      const section = extractManPageSection(statusManPage, 'current-command');
      expect(section).not.toBeNull();
      expect(section).toContain('current-command');
      expect(section).toContain('currently-running');
    });

    it('extracts `job-control` section with arguments', () => {
      const section = extractManPageSection(statusManPage, 'job-control');
      expect(section).not.toBeNull();
      expect(section).toContain('job-control');
      expect(section).toContain('CONTROL_TYPE');
    });

    it('does not match mid-paragraph text', () => {
      // "is-full-job-control" appears in the SYNOPSIS section too, but those
      // lines start with " status is-full-job-control" — the subcommand
      // is not the first word after the indent. The extractor should pick
      // only the description entry where `is-full-job-control` leads.
      const section = extractManPageSection(statusManPage, 'is-full-job-control');
      expect(section).not.toBeNull();
      // The extracted section should be short (the entry + description),
      // not the entire man page
      const lineCount = section!.split('\n').filter(l => l.trim() !== '').length;
      expect(lineCount).toBeLessThan(5);
    });

    it('returns null for nonexistent subcommand', () => {
      const section = extractManPageSection(statusManPage, 'nonexistent-subcommand');
      expect(section).toBeNull();
    });
  });

  describe('uppercase header style (path)', () => {
    let pathManPage: string;

    beforeAll(async () => {
      pathManPage = await execCommandDocs('path');
    });

    it('extracts NORMALIZE SUBCOMMAND section', () => {
      const section = extractManPageSection(pathManPage, 'normalize');
      expect(section).not.toBeNull();
      expect(section).toContain('NORMALIZE SUBCOMMAND');
      expect(section).toContain('path normalize');
      expect(section).toContain('normalized versions');
    });

    it('extracts RESOLVE SUBCOMMAND section', () => {
      const section = extractManPageSection(pathManPage, 'resolve');
      expect(section).not.toBeNull();
      expect(section).toContain('RESOLVE SUBCOMMAND');
      expect(section).toContain('path resolve');
    });

    it('extracts BASENAME SUBCOMMAND section', () => {
      const section = extractManPageSection(pathManPage, 'basename');
      expect(section).not.toBeNull();
      expect(section).toContain('BASENAME SUBCOMMAND');
      expect(section).toContain('path basename');
    });

    it('extracts CHANGE-EXTENSION SUBCOMMAND section', () => {
      const section = extractManPageSection(pathManPage, 'change-extension');
      expect(section).not.toBeNull();
      expect(section).toContain('CHANGE-EXTENSION SUBCOMMAND');
    });

    it('extracts FILTER SUBCOMMAND section', () => {
      const section = extractManPageSection(pathManPage, 'filter');
      expect(section).not.toBeNull();
      expect(section).toContain('FILTER SUBCOMMAND');
      expect(section).toContain('path filter');
    });

    it('extracts SORT SUBCOMMAND section', () => {
      const section = extractManPageSection(pathManPage, 'sort');
      expect(section).not.toBeNull();
      expect(section).toContain('SORT SUBCOMMAND');
    });

    it('section does not leak into next section', () => {
      const section = extractManPageSection(pathManPage, 'normalize');
      expect(section).not.toBeNull();
      // Should NOT contain the next section's header
      expect(section).not.toContain('RESOLVE SUBCOMMAND');
    });

    it('returns null for nonexistent subcommand', () => {
      const section = extractManPageSection(pathManPage, 'nonexistent');
      expect(section).toBeNull();
    });
  });

  describe('commands with dedicated subcommand man pages (string)', () => {
    it('string split has its own man page via string-split', async () => {
      // string subcommands have dedicated man pages, so the fallback
      // extraction should not be needed — execCommandDocs resolves directly
      const docs = await execCommandDocs('string', 'split');
      expect(docs).toBeTruthy();
      expect(docs).toContain('STRING-SPLIT');
    });

    it('string match has its own man page via string-match', async () => {
      const docs = await execCommandDocs('string', 'match');
      expect(docs).toBeTruthy();
      expect(docs).toContain('STRING-MATCH');
    });
  });

  describe('edge cases', () => {
    it('returns null for empty man text', () => {
      expect(extractManPageSection('', 'normalize')).toBeNull();
    });

    it('returns null for man text with no matching section', () => {
      const fakeManPage = [
        'COMMAND(1)',
        '',
        'NAME',
        ' command - does something',
        '',
        'DESCRIPTION',
        ' This command does things.',
      ].join('\n');
      expect(extractManPageSection(fakeManPage, 'nonexistent')).toBeNull();
    });

    it('handles indented entry with no description lines', () => {
      const manText = [
        ' some-subcmd',
        ' other-subcmd',
        '        Has a description.',
      ].join('\n');
      const section = extractManPageSection(manText, 'some-subcmd');
      expect(section).not.toBeNull();
      expect(section).toBe(' some-subcmd');
    });

    it('handles uppercase header at end of man page', () => {
      const manText = [
        'FIRST SUBCOMMAND',
        '    cmd first [OPTIONS]',
        '',
        ' This is the first subcommand.',
        '',
        'LAST SUBCOMMAND',
        '    cmd last [OPTIONS]',
        '',
        ' This is the last subcommand.',
      ].join('\n');
      const section = extractManPageSection(manText, 'last');
      expect(section).not.toBeNull();
      expect(section).toContain('LAST SUBCOMMAND');
      expect(section).toContain('last subcommand');
      expect(section).not.toContain('FIRST SUBCOMMAND');
    });
  });
});
