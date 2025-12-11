import { documents, LspDocument } from '../src/document';
import { resolveLspDocumentForHelperTestFile } from './helpers';
import { initializeParser } from '../src/parser';
import { SyntaxNode } from 'web-tree-sitter';
import TestWorkspace, { TestFile } from './test-workspace-utils';
import { Workspace } from '../src/utils/workspace';
import { workspaceManager } from '../src/utils/workspace-manager';
import { logger } from '../src/logger';

describe('LspDocument tests', () => {
  beforeAll(() => {
    logger.setSilent();
  });

  describe('resolveLspDocumentForHelperTestFile() tests', () => {
    it('test an document is created not in ~/.config/fish/functions/ directory', () => {
      const doc: LspDocument = resolveLspDocumentForHelperTestFile('./fish_files/simple/set_var.fish', false);
      expect(doc).not.toBeNull();
      expect(doc.isAutoloaded()).toBeFalsy();
    });

    it('test an document is created in ~/.config/fish/functions/ directory', () => {
      const doc: LspDocument = resolveLspDocumentForHelperTestFile('./fish_files/simple/set_var.fish');
      expect(doc).not.toBeNull();
      expect(doc.isAutoloaded()).toBeTruthy();
      expect(doc.uri.endsWith('functions/set_var.fish')).toBeTruthy();
    });

    it('testing ability to parse a document', async () => {
      const parser = await initializeParser();
      const doc: LspDocument = resolveLspDocumentForHelperTestFile('./fish_files/simple/set_var.fish');
      const root: SyntaxNode = parser.parse(doc.getText()).rootNode;
      expect(root.children).toHaveLength(2);
      expect(doc.lineCount === 2).toBeTruthy();
    });
  });

  describe('LspDocument methods/properties', () => {
    const ws = TestWorkspace.create({
      name: 'lsp-document-test',
      debug: false,
    }).addFiles(
      TestFile.config(`
set -gx EDITOR nvim
set -gx VISUAL nvim

set -gx PATH /usr/local/bin $PATH

function greet
    echo "Hello, World!"
end

function keybindings
    bind \\e[1~ beginning-of-line
    bind \\e[4~ end-of-line
end`,
      ),
      TestFile.confd('say_hello.fish', `
function say_hello
    echo "Hello from say_hello function!"
end`,
      ),
      TestFile.script('run_script.fish',
        `#!/usr/bin/env fish

function main_1
    set -f fish_trace on
    echo 'Running main_1'
end

function main_2
    set fish_trace on
    echo 'Running main_2'
end

function main_3
    set -x fish_trace on
    echo 'Running main_3'
end`,
      ),
      TestFile.function('complex_function.fish', `
function complex_function
    argparse a/alpha b/beta c/charlie d/delta h/help -- $argv
    or return 1

    function print_help # should have diagnostic 4004
        echo "Usage: complex_function [-a|--alpha] [-b|--beta] [-c|--charlie] [-d|--delta] [-h|--help]"
    end

    set -ql _flag_help && print_help && return 0

    set input ''

    set -ql _flag_alpha && set -a input "Alpha"
    set -ql _flag_beta && set -a input "Beta"
    set -ql _flag_charlie && set -a input "Charlie"
    set -ql _flag_delta && set -a input "Delta"

    echo $input
end

function helper_function # should have diagnostic 4004
    echo "This is a helper function."
end`,
      ),
      TestFile.completion('complex_function.fish', `
complete -c complex_function -s a -l alpha   -d "Alpha option" 
complete -c complex_function -s b -l beta    -d "Beta option" 
complete -c complex_function -s c -l charlie -d "Charlie option" 
complete -c complex_function -s d -l delta   -d "Delta option" 
complete -c complex_function -s h -l help    -d "show help message"`),
    ).initialize();

    describe('base', () => {
      let config_doc: LspDocument;
      let script_doc: LspDocument;
      let confd_doc: LspDocument;
      let func_doc: LspDocument;
      let cmp_doc: LspDocument;

      beforeAll(async () => {
        config_doc = ws.find('config.fish')!;
        script_doc = ws.find('run_script.fish')!;
        confd_doc = ws.find('conf.d/say_hello.fish')!;
        func_doc = ws.find('functions/complex_function.fish')!;
        cmp_doc = ws.find('completions/complex_function.fish')!;
      });

      it('total documents', () => {
        expect(ws.documents.length).toBe(5);
      });

      it('get', () => {
        ws.documents.forEach(doc => {
          const fetched = ws.find(doc.uri)!;
          expect(fetched.uri).toBe(doc.uri);
        });
      });

      it('lineCount', () => {
        expect(config_doc.lineCount).toBe(14);
        expect(script_doc.lineCount).toBe(16);
        expect(confd_doc.lineCount).toBe(4);
        expect(func_doc.lineCount).toBe(24);
        expect(cmp_doc.lineCount).toBe(6);
      });

      it('getText()', () => {
        const text = func_doc.getText();
        expect(text).toContain('function complex_function');
        expect(text).toContain('argparse a/alpha b/beta c/charlie d/delta h/help -- $argv');
        expect(text).toContain('function print_help');
        expect(text).toContain('function helper_function');
      });

      it('isAutoloaded()', () => {
        const autoloaded_docs = [config_doc, confd_doc, func_doc, cmp_doc];
        const non_autoloaded_docs = [script_doc];
        autoloaded_docs.forEach(doc => {
          expect(doc.isAutoloadedUri()).toBeTruthy();
          if (doc.getAutoloadType() === 'completions') {
            expect(doc.isAutoloaded()).toBeFalsy();
          }
        });
        non_autoloaded_docs.forEach(doc => {
          expect(doc.isAutoloaded()).toBeFalsy();
        });
      });

      it('getAutoloadType()', () => {
        expect(config_doc.getAutoloadType()).toBe('config');
        expect(confd_doc.getAutoloadType()).toBe('conf.d');
        expect(func_doc.getAutoloadType()).toBe('functions');
        expect(cmp_doc.getAutoloadType()).toBe('completions');
        expect(script_doc.getAutoloadType()).toBe('');
      });

      it('getFileName()', () => {
        expect(config_doc.getFileName()).toBe('config.fish');
        expect(confd_doc.getFileName()).toBe('say_hello.fish');
        expect(func_doc.getFileName()).toBe('complex_function.fish');
        expect(cmp_doc.getFileName()).toBe('complex_function.fish');
        expect(script_doc.getFileName()).toBe('run_script.fish');
      });

      it('hasShebang()', () => {
        expect(script_doc.hasShebang()).toBeTruthy();
        [config_doc, confd_doc, func_doc, cmp_doc].forEach(doc => {
          expect(doc.hasShebang()).toBeFalsy();
        });
      });

      it('getLine()', () => {
        expect(config_doc.getLine(1)).toBe('set -gx EDITOR nvim');
        expect(script_doc.getLine(0)).toBe('#!/usr/bin/env fish');
        expect(confd_doc.getLine(1)).toBe('function say_hello');
        expect(func_doc.getLine(5)).toBe('    function print_help # should have diagnostic 4004');
        expect(cmp_doc.getLine(4)).toBe('complete -c complex_function -s d -l delta   -d "Delta option" ');
      });

      it('version()', () => {
        ws.documents.forEach(doc => {
          expect(doc.version).toBe(1);
        });
      });

      it('positionAt()', () => {
        expect(func_doc.positionAt(0)).toEqual({ line: 0, character: 0 });
        expect(func_doc.positionAt(10)).toEqual({ line: 1, character: 9 });
        expect(func_doc.positionAt(25)).toEqual({ line: 1, character: 24 });
        expect(func_doc.positionAt(100)).toEqual({ line: 3, character: 11 });
      });

      it('offsetAt()', () => {
        expect(func_doc.offsetAt({ line: 0, character: 0 })).toBe(0);
        expect(func_doc.offsetAt({ line: 1, character: 9 })).toBe(10);
        expect(func_doc.offsetAt({ line: 1, character: 24 })).toBe(25);
        expect(func_doc.offsetAt({ line: 3, character: 11 })).toBe(100);
      });

      it('getRelativeFilenameToWorkspace()', () => {
        expect(config_doc.getRelativeFilenameToWorkspace()).toBe('config.fish');
        expect(confd_doc.getRelativeFilenameToWorkspace()).toBe('conf.d/say_hello.fish');
        expect(func_doc.getRelativeFilenameToWorkspace()).toBe('functions/complex_function.fish');
        expect(cmp_doc.getRelativeFilenameToWorkspace()).toBe('completions/complex_function.fish');
        expect(script_doc.getRelativeFilenameToWorkspace()).toBe('run_script.fish');
      });

      it('getTree()', async () => {
        const tree = func_doc.getTree();
        expect(tree.length).toBeGreaterThan(10);
      });

      it('updateVersion()', () => {
        const initialVersion = func_doc.version;
        func_doc.updateVersion(2);
        expect(func_doc.version).toBe(initialVersion + 1);
      });

      describe('static', () => {
        it('is()', () => {
          expect(LspDocument.is(config_doc)).toBeTruthy();
          expect(LspDocument.is(confd_doc)).toBeTruthy();
          expect(LspDocument.is(func_doc)).toBeTruthy();
          expect(LspDocument.is(cmp_doc)).toBeTruthy();
          expect(LspDocument.is(script_doc)).toBeTruthy();
        });
      });
    });

    describe('documents', () => {
      it('querying all function definitions', () => {
        expect(documents.all()).toHaveLength(5);
      });

      it('querying all isAutoloadedUri documents', () => {
        const autoloadedDocs = documents.all().filter(doc => doc.isAutoloadedUri());
        expect(autoloadedDocs).toHaveLength(4);
      });

      it('find completions/functions documents', () => {
        const funcDocs = documents.all().filter(doc => doc.getAutoloadType() === 'functions');
        const cmpDocs = documents.all().filter(doc => doc.getAutoloadType() === 'completions');
        expect(funcDocs).toHaveLength(1);
        expect(cmpDocs).toHaveLength(1);
        expect(funcDocs[0]!.getAutoLoadName()).toBe(cmpDocs[0]!.getAutoLoadName());
      });
    });

    describe('workspace/workspaceManager', () => {
      let workspace: Workspace;

      beforeEach(async () => {
        workspace = ws.workspace!;
        workspaceManager.add(workspace);
        workspaceManager.setCurrent(workspace);
      });

      it('all workspace uris', async () => {
        const uris = workspace.uris.all;
        expect(uris).toHaveLength(5);
      });

      it('find all functions in workspace', async () => {
        const results = workspace.allDocuments().filter(d => d.isAutoloadedFunction());
        expect(results).toHaveLength(1);
      });

      it('find all possible fish files with autoloaded functions', async () => {
        const results = workspace.allDocuments().filter(d => d.isAutoloadedUri());
        expect(results).toHaveLength(4);
        [
          'config.fish',
          'conf.d/say_hello.fish',
          'functions/complex_function.fish',
          'completions/complex_function.fish',
        ].forEach(expectedPath => {
          expect(results.map(r => r.getRelativeFilenameToWorkspace())).toContain(expectedPath);
        });
      });

      it('get document by ending path', async () => {
        const found = workspace.findDocument(d => d.uri.endsWith('functions/complex_function.fish'));
        expect(found).not.toBeNull();
      });

      it('workspace re-analyze all documents', async () => {
        workspaceManager.all.forEach(ws => ws.setAllPending());
        const result = await workspaceManager.analyzePendingDocuments();
        expect(result.totalDocuments).toBe(5);
      });
    });
  });
});

