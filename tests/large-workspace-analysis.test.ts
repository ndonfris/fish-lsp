import { analyzer, Analyzer } from '../src/analyze';
import TestWorkspace, { TestFile } from './test-workspace-utils';
import { logger } from '../src/logger';
import { LspDocument } from '../src/document';
import { setLogger } from './helpers';
import path from 'path';
import { uriToReadablePath } from '../src/utils/translation';
import { FishDiagnostic } from '../src/diagnostics/validate';
import { getDiagnosticsAsync } from '../src/diagnostics/async-validate';
import { namedNodesGen, nodesGen } from '../src/utils/tree-sitter';
import { findUnreachableCode } from '../src/parsing/unreachable';
import { ErrorCodes } from '../src/diagnostics/error-codes';
import { a } from 'vitest/dist/chunks/suite.d.FvehnV49.js';
import { isDiagnosticComment, parseDiagnosticComment } from '../src/diagnostics/comments-handler';
import { config } from '../src/config';
import { computeDiagnosticRanges, createDiagnosticChecker, DiagnosticRangeChecker } from '../src/diagnostics/diagnostic-ranges';
import FishServer from '../src/server';
import { FishSymbol } from '../src/parsing/symbol';
import { allUnusedLocalReferences, getReferences } from '../src/references';
import { Diagnostic } from 'vscode-languageserver';
import { createSymbolKindLookup } from '../src/parsing/symbol-kinds';
import { isBuiltin } from 'module';

setLogger();
logger.setConsole(global.console).setSilent(false);

//  big2.fish created with:
//
// ```
// echo "#!/usr/bin/env fish" >big2.fish
// echo '
// ## GENERATED WITH COMMAND:
// ##
// ## echo "#!/usr/bin/env fish" >big2.fish
// ## for i in (seq 1 4000)
// ##     echo "set var_$i \'$i\'">> big2.fish
// ## end
// ##
// '
//
// for i in (seq 1 4000)
//     echo "set var_$i '$i'">> big2.fish
// end
//
// ```

const _fileVars: string[] = [];
const _fileFuncs: string[] = [];
const _comments: string[] = [];
const _multiline: string[] = [];
const _functionWithUnreachable: string[] = [];
for (let i = 0; i < 500; i++) {
  _fileVars.push(`set -U var_${i} '${i}';`);
  _fileFuncs.push(`function func_${i} -d 'Function number ${i}'; echo $argv; end;`);
}

for (let i = 0; i < 240; i++) {
  if (i % 3 === 0) {
    _comments.push(`# TODO: This is a TODO comment number ${i}`);
    continue;
  } else if (i % 3 === 1) {
    _comments.push(`# @fish-lsp-disable-next-line ${ErrorCodes.allErrorCodes.join(' ')}`);
    _comments.push('echo "This line has a disabled diagnostic comment above it."');
    _comments.push('');
    continue;
  } else {
    _comments.push(`# @fish-lsp-disable ${4004}`);
    _comments.push(`function disabled_func_${i} -a a b c d -d 'This function has a disabled diagnostic comment above it.'; echo $argv; end;`);
    _comments.push('# @fish-lsp-enable');
  }
}

for (let i = 0; i < 100; i++) {
  _functionWithUnreachable.push([
    `function unreachable_func_${i} -d 'Function with unreachable code number ${i}'`,
    '    return 1',
    '    echo "This is reachable code.";',
    'end',
  ].join('\n'));
  _multiline.push([
    'echo \'$i line 1\'\\',
    '     \'$i line 2\'\\',
    '     \'$i line 3\'\\',
    '     \'$i line 4\'\\',
    '     \'$i line 5\';',
  ].join('\n'));
}

const fileWithLotsOfDiagnostics = [
  '#!/usr/bin/env fish',
  ..._functionWithUnreachable,
  ..._fileFuncs,
  ..._fileVars,
  ..._comments,
  ..._multiline,
].join('\n');

describe('Large Workspace Analysis', () => {
  const workspace = TestWorkspace.create({ name: 'large-workspace' }).addFiles(
    { relativePath: 'src/file1.fish', content: 'function file1 -d "file1 script"; echo $argv; end;' },
    TestFile.script('file2.fish', '#!/usr/bin/env fish\n echo "Hello, World!"\necho a\necho b\necho c\necho d\necho e\necho f\necho g\necho h\necho i\necho j\necho k\necho l\necho m\necho n\necho o\necho p\necho q\necho r\necho s\necho t\necho u\necho v\necho w\necho x\necho y\necho z\n'),
    { relativePath: 'medium_1.fish', content: fileWithLotsOfDiagnostics },
  ).addDocuments(
    LspDocument.createFromPath(path.join(__dirname, 'workspaces/profiling/big1.fish')),
    LspDocument.createFromPath(path.join(__dirname, 'workspaces/profiling/big2.fish')),
  ).initialize();

  let docFile1: LspDocument;
  let docFile2: LspDocument;
  let docBig1: LspDocument;
  let docBig2: LspDocument;
  let mediumDoc1: LspDocument;

  beforeAll(async () => {
    await Analyzer.initialize();
    docFile1 = workspace.getDocument('src/file1.fish')!;
    docFile2 = workspace.getDocument('file2.fish')!;
    docBig1 = workspace.getDocument('big1.fish')!;
    docBig2 = workspace.getDocument('big2.fish')!;
    mediumDoc1 = workspace.getDocument('medium_1.fish')!;
    for (const doc of [docFile1, docFile2, docBig1, docBig2, mediumDoc1]) {
      analyzer.analyze(doc);
    }
  });

  describe('docs tests', () => {
    it('docFile1 analysis', () => {
      expect(docFile1).toBeDefined();
    });

    it('docFile2 analysis', () => {
      expect(docFile2).toBeDefined();
    });

    it('docBig1 analysis', () => {
      expect(docBig1).toBeDefined();
    });

    it('docBig2 analysis', () => {
      expect(docBig2).toBeDefined();
    });

    it('analyze large workspace', () => {
      for (const doc of [docFile1, docFile2, docBig1, docBig2]) {
        const cached = analyzer.analyze(doc);
        expect(cached).toBeDefined();
        console.log(`Analyzed document: ${doc.getRelativeFilenameToWorkspace()} with ${doc.lineCount} lines.`);
      }
    });
  });

  describe('FishSymbol', () => {
    it('retrieve many variables from big1.fish', () => {
      const startTime = performance.now();
      const cached = analyzer.analyze(docBig1);
      const symbols = analyzer.getFlatDocumentSymbols(docBig1.uri);
      expect(symbols).toBeDefined();
      // symbols.forEach((sym) => {
      //   // console.log({
      //   //   name: sym.name,
      //   //   kind: sym.kind,
      //   //   fishKind: sym.fishKind,
      //   // })
      // })

      const endTime = performance.now();
      console.log(`Retrieved ${symbols.length} symbols in ${(endTime - startTime).toFixed(2)} ms`);
    });
  });

  describe('diagnosticTests', () => {
    it('benchmark unreachable code detection in large files', { timeout: 30000 }, () => {
      console.log('\n=== BENCHMARKING DIAGNOSTICS (Unreachable Only) ===\n');

      // Test on big1.fish
      const cached1 = analyzer.analyze(docBig1);
      console.log(`Document: ${docBig1.getRelativeFilenameToWorkspace()}`);
      console.log(`Lines: ${docBig1.lineCount}`);
      console.log(`Total nodes: ${cached1.root?.descendantCount || 0}`);

      // Benchmark just unreachable code detection
      const unreachableStart = performance.now();
      const unreachableNodes = findUnreachableCode(cached1.root!);
      const unreachableEnd = performance.now();
      const unreachableTime = unreachableEnd - unreachableStart;
      console.log('\n[Unreachable Detection Only]');
      console.log(`  Time: ${unreachableTime.toFixed(2)} ms`);
      console.log(`  Found: ${unreachableNodes.length} unreachable nodes`);
      console.log(`  Nodes per millisecond: ${((cached1.root?.descendantCount || 0) / unreachableTime).toFixed(0)}`);

      // Test on big2.fish for comparison
      console.log('\n---\n');
      const cached2 = analyzer.analyze(docBig2);
      console.log(`Document: ${docBig2.getRelativeFilenameToWorkspace()}`);
      console.log(`Lines: ${docBig2.lineCount}`);

      const unreachableStart2 = performance.now();
      const unreachableNodes2 = findUnreachableCode(cached2.root!);
      const unreachableEnd2 = performance.now();
      const unreachableTime2 = unreachableEnd2 - unreachableStart2;
      console.log('\n[Unreachable Detection Only]');
      console.log(`  Time: ${unreachableTime2.toFixed(2)} ms`);
      console.log(`  Found: ${unreachableNodes2.length} unreachable nodes`);
      console.log(`  Nodes per millisecond: ${((cached2.root?.descendantCount || 0) / unreachableTime2).toFixed(0)}`);

      // Just verify we can run unreachable detection without errors
      expect(unreachableNodes.length).toBeGreaterThanOrEqual(0);
      expect(unreachableNodes2.length).toBeGreaterThanOrEqual(0);
    });

    it('benchmark FULL diagnostic calculation on large files', { timeout: 600000 }, () => {
      console.log('\n=== BENCHMARKING FULL DIAGNOSTICS (Warning: Very Slow!) ===\n');

      // Test on big1.fish
      const cached1 = analyzer.analyze(docBig1);
      console.log(`Document: ${docBig1.getRelativeFilenameToWorkspace()}`);
      console.log(`Lines: ${docBig1.lineCount}`);
      console.log(`Total nodes: ${cached1.root?.descendantCount || 0}`);

      // Benchmark unreachable detection first
      const unreachableStart = performance.now();
      const unreachableNodes = findUnreachableCode(cached1.root!);
      const unreachableEnd = performance.now();
      const unreachableTime = unreachableEnd - unreachableStart;
      console.log('\n[Unreachable Detection]');
      console.log(`  Time: ${unreachableTime.toFixed(2)} ms`);
      console.log(`  Found: ${unreachableNodes.length} unreachable nodes`);

      // Benchmark ALL diagnostics
      // console.log(`\n[Computing All Diagnostics...]`);
      // const allDiagStart = performance.now();
      // const diagnostics = getDiagnostics(cached1.root!, cached1.document);
      // const allDiagEnd = performance.now();
      // const allDiagTime = allDiagEnd - allDiagStart;
      // console.log(`\n[All Diagnostics]`);
      // console.log(`  Time: ${allDiagTime.toFixed(2)} ms (${(allDiagTime / 1000).toFixed(2)}s)`);
      // console.log(`  Total diagnostics: ${diagnostics.length}`);

      // const unreachableDiagnostics = diagnostics.filter(d => d.code === ErrorCodes.unreachableCode);
      // console.log(`  Unreachable diagnostics: ${unreachableDiagnostics.length}`);
      //
      // // Performance breakdown
      // const percentOfTotal = ((unreachableTime / allDiagTime) * 100).toFixed(1);
      // console.log(`\n[Performance Breakdown]`);
      // console.log(`  Unreachable detection: ${unreachableTime.toFixed(2)} ms (${percentOfTotal}% of total)`);
      // console.log(`  Other diagnostics: ${(allDiagTime - unreachableTime).toFixed(2)} ms (${(100 - parseFloat(percentOfTotal)).toFixed(1)}% of total)`);
      // console.log(`  Nodes per millisecond: ${((cached1.root?.descendantCount || 0) / unreachableTime).toFixed(0)}`);

      // Test on big2.fish for comparison
      console.log('\n---\n');
      const cached2 = analyzer.analyze(docBig2);
      console.log(`Document: ${docBig2.getRelativeFilenameToWorkspace()}`);
      console.log(`Lines: ${docBig2.lineCount}`);

      const unreachableStart2 = performance.now();
      const unreachableNodes2 = findUnreachableCode(cached2.root!);
      const unreachableEnd2 = performance.now();
      const unreachableTime2 = unreachableEnd2 - unreachableStart2;
      console.log('\n[Unreachable Detection]');
      console.log(`  Time: ${unreachableTime2.toFixed(2)} ms`);
      console.log(`  Found: ${unreachableNodes2.length} unreachable nodes`);

      console.log('\n[Computing All Diagnostics...]');
      const allDiagStart2 = performance.now();
      const diagnostics2 = await getDiagnosticsAsync(cached2.root!, cached2.document);
      const allDiagEnd2 = performance.now();
      const allDiagTime2 = allDiagEnd2 - allDiagStart2;
      console.log('\n[All Diagnostics]');
      console.log(`  Time: ${allDiagTime2.toFixed(2)} ms (${(allDiagTime2 / 1000).toFixed(2)}s)`);
      console.log(`  Total diagnostics: ${diagnostics2.length}`);

      const percentOfTotal2 = (unreachableTime2 / allDiagTime2 * 100).toFixed(1);
      console.log('\n[Performance Breakdown]');
      console.log(`  Unreachable detection: ${unreachableTime2.toFixed(2)} ms (${percentOfTotal2}% of total)`);
      console.log(`  Other diagnostics: ${(allDiagTime2 - unreachableTime2).toFixed(2)} ms (${(100 - parseFloat(percentOfTotal2)).toFixed(1)}% of total)`);

      // expect(diagnostics.length).toBeGreaterThanOrEqual(0);
      expect(diagnostics2.length).toBeGreaterThanOrEqual(0);
    });

    it('benchmark ASYNC diagnostic calculation without yielding', async () => {
      const startTime = performance.now();
      console.log('\n=== BENCHMARKING ASYNC DIAGNOSTICS (Without Event Loop Yielding) ===\n');
      const fileDoc = mediumDoc1;
      const cached = analyzer.ensureCachedDocument(fileDoc).ensureParsed();
      console.log(`Document: ${fileDoc.getRelativeFilenameToWorkspace()}`);
      console.log(`Lines: ${fileDoc.lineCount}`);
      console.log(`Total nodes: ${cached.root?.descendantCount || 0}`);
      const { root } = cached!;
      // const startIterPreviewTime = performance.now();
      nodesGen(root).forEach(async (n, i) => {
        if (n.isError) {
          console.log('Found error node during preview iteration: ', {
            type: n.type,
            line: n.startPosition.row + 1,
            collected: i,
          });
        }
        if (isDiagnosticComment(n)) {
          const comment = parseDiagnosticComment(n);
          console.log('Found diagnostic comment node during preview iteration: ', {
            type: n.type,
            found: {
              ...comment,
            },
            line: n.startPosition.row + 1,
            collected: i,
          });
        }
        if (n.type === 'command_name' && n.parent?.type === 'command') {
          console.log('Found command name node during preview iteration: ', {
          });
        }

        if (i % 10 === 0) {
          console.log({ name: n.type, line: n.startPosition.row + 1, collected: i });
        }
      });
      const iterPreviewTime = performance.now();
      console.log('\n[Nodes Preview]');
      console.log(`  Previewed named nodes in ${(iterPreviewTime - startTime).toFixed(2)} ms`);

      let i = 0;
      const startIterTime = performance.now();
      for await (const n of namedNodesGen(cached.root!)) {
        if (i % 10 === 0) {
          // console.log({ name: n.type, line: n.startPosition.row + 1, collected: i });
          // console.log({ collected: i });
        }
        i++;
      }
      const iterTime = performance.now();
      console.log('\n[Named Nodes in the Document]');
      console.log(`  Iterated ${i} named nodes in ${(iterTime - startTime).toFixed(2)} ms`);

      // for (const node of namedNodesGen(cached.root!)) {
      //   console.log({ type: node.type, startLine: node.startPosition.row + 1 });
      // }
      // const diagnosticsSync = getDiagnostics(cached.root!, cached.document);
      console.log('\n[Sync Diagnostics (with maxDiagnostics: 10)]');
      // console.log(`  Total diagnostics: ${diagnosticsSync.length} (limited to 10)`);
      // Use maxDiagnostics: 10 to stop early after finding 10 diagnostics
      const controller = new AbortController();
      // const diagnostics = await getDiagnosticsAsync(root, doc, controller.signal, 10);
      config.fish_lsp_diagnostic_disable_error_codes = [];
      const diagnosticsAsync = await getDiagnosticsAsync(cached.root!, cached.document, controller.signal);
      console.log('\n[Async Diagnostics (with maxDiagnostics: 10)]');
      console.log(`  Total diagnostics: ${diagnosticsAsync.length} (limited to 10)`);

      for (const diag of diagnosticsAsync) {
        console.log(`  [${diag.code}] ${diag.message} (Line ${diag.range.start.line + 1})`);
      }
      const endTime = performance.now();
      const totalTime = (endTime - startTime).toFixed(2).toString() + 'ms';
      console.log(`\n  Total Time: ${totalTime}`);
    }, 2000);

    it('benchmark ASYNC diagnostic calculation with yielding', { timeout: 600000 }, async () => {
      console.log('\n=== BENCHMARKING ASYNC DIAGNOSTICS (With Event Loop Yielding) ===\n');

      // Test on big1.fish
      const cached1 = analyzer.analyze(docBig1);
      console.log(`Document: ${docBig1.getRelativeFilenameToWorkspace()}`);
      console.log(`Lines: ${docBig1.lineCount}`);
      console.log(`Total nodes: ${cached1.root?.descendantCount || 0}`);

      // Benchmark unreachable detection first
      const unreachableStart = performance.now();
      const unreachableNodes = findUnreachableCode(cached1.root!);
      const unreachableEnd = performance.now();
      const unreachableTime = unreachableEnd - unreachableStart;
      console.log('\n[Unreachable Detection]');
      console.log(`  Time: ${unreachableTime.toFixed(2)} ms`);

      // Benchmark ASYNC diagnostics (with yielding)
      console.log('\n[Computing All Diagnostics Async...]');
      const asyncDiagStart = performance.now();
      const diagnosticsAsync = await getDiagnosticsAsync(cached1.root!, cached1.document);
      const asyncDiagEnd = performance.now();
      const asyncDiagTime = asyncDiagEnd - asyncDiagStart;
      console.log('\n[Async Diagnostics (with yielding)]');
      console.log(`  Time: ${asyncDiagTime.toFixed(2)} ms (${(asyncDiagTime / 1000).toFixed(2)}s)`);
      console.log(`  Total diagnostics: ${diagnosticsAsync.length}`);

      const asyncUnreachableDiagnostics = diagnosticsAsync.filter(d => d.code === ErrorCodes.unreachableCode);
      console.log(`  Unreachable diagnostics: ${asyncUnreachableDiagnostics.length}`);

      // Performance breakdown
      const asyncPercentOfTotal = (unreachableTime / asyncDiagTime * 100).toFixed(1);
      console.log('\n[Performance Breakdown]');
      console.log(`  Unreachable detection: ${unreachableTime.toFixed(2)} ms (${asyncPercentOfTotal}% of total)`);
      console.log(`  Other diagnostics: ${(asyncDiagTime - unreachableTime).toFixed(2)} ms (${(100 - parseFloat(asyncPercentOfTotal)).toFixed(1)}% of total)`);

      // Benchmark synchronous for comparison
      // console.log(`\n[Computing All Diagnostics Sync for comparison...]`);
      // const syncDiagStart = performance.now();
      // const diagnosticsSync = getDiagnostics(cached1.root!, cached1.document);
      // const syncDiagEnd = performance.now();
      // const syncDiagTime = syncDiagEnd - syncDiagStart;
      // console.log(`\n[Sync Diagnostics (blocking)]`);
      // console.log(`  Time: ${syncDiagTime.toFixed(2)} ms (${(syncDiagTime / 1000).toFixed(2)}s)`);
      // console.log(`  Total diagnostics: ${diagnosticsSync.length}`);
      //
      // // Comparison
      // const speedDiff = ((syncDiagTime - asyncDiagTime) / syncDiagTime * 100).toFixed(1);
      // console.log(`\n[Async vs Sync Comparison]`);
      // console.log(`  Async: ${asyncDiagTime.toFixed(2)} ms`);
      // console.log(`  Sync:  ${syncDiagTime.toFixed(2)} ms`);
      // if (asyncDiagTime < syncDiagTime) {
      //   console.log(`  Async is ${speedDiff}% faster`);
      // } else {
      //   console.log(`  Async is ${Math.abs(parseFloat(speedDiff))}% slower (overhead from yielding)`);
      // }

      // Verify both produce same results
      // expect(diagnosticsAsync.length).toBe(diagnosticsSync.length);
      // expect(asyncUnreachableDiagnostics.length).toBe(diagnosticsSync.filter(d => d.code === ErrorCodes.unreachableCode).length);
    });
  });

  describe('node analysis', () => {
    it('retrieve many variable nodes from big1.fish', () => {
      const startTime = performance.now();
      const cached = analyzer.analyze(docBig1);
      let i = 0;
      for (const node of nodesGen(cached.root!)) {
        // if (['\n', '\\', "'", '"', ';', '$', 'for', 'in'].includes(node.type)) continue;
        // console.log({
        //   type: node.type,
        //   i: i
        // })
        i++;
      }
      const endTime = performance.now();
      console.log(`Traversed nodes in ${(endTime - startTime).toFixed(2).toString()} ms`);
      console.log(`Total nodes: ${i}`);
      console.log(`Total lines: ${docBig1.lineCount}`);
    });
  });

  describe('diagnostic ranges pre-computation', () => {
    it('should compute diagnostic ranges for medium document', () => {
      console.log('\n=== DIAGNOSTIC RANGES PRE-COMPUTATION TEST ===\n');

      const cached = analyzer.analyze(mediumDoc1);
      const maxLine = mediumDoc1.lineCount;

      console.log(`Document: ${mediumDoc1.getRelativeFilenameToWorkspace()}`);
      console.log(`Total lines: ${maxLine}`);
      console.log(`Total nodes: ${cached.root?.descendantCount || 0}`);

      // Time the computation
      const startTime = performance.now();
      const result = computeDiagnosticRanges(cached.root!, maxLine);
      const computeTime = performance.now() - startTime;

      console.log('\n[Diagnostic Ranges Computation]');
      console.log(`  Compute time: ${computeTime.toFixed(2)} ms`);
      console.log(`  Internal compute time: ${result.computeTimeMs.toFixed(2)} ms`);
      console.log(`  Diagnostic comments found: ${result.commentCount}`);
      console.log(`  Disabled ranges created: ${result.disabledRanges.length}`);
      console.log(`  Lines with invalid codes: ${result.invalidCodeLines.size}`);

      // Show some sample ranges
      console.log('\n[Sample Disabled Ranges (first 10)]');
      for (const range of result.disabledRanges.slice(0, 10)) {
        const endLine = range.endLine === -1 ? 'EOF' : range.endLine;
        console.log(`  Lines ${range.startLine}-${endLine}: code ${range.code}`);
      }

      // Create checker and time lookups
      const checkerStart = performance.now();
      const checker = new DiagnosticRangeChecker(result, maxLine);
      const checkerTime = performance.now() - checkerStart;

      console.log('\n[DiagnosticRangeChecker Creation]');
      console.log(`  Creation time: ${checkerTime.toFixed(2)} ms`);
      const summary = checker.getSummary();
      console.log(`  Pre-computed lines: ${summary.precomputedLines}`);
      console.log(`  Lines with disabled codes: ${summary.linesWithDisabledCodes}`);

      // Benchmark lookups
      const lookupCount = 10000;
      const lookupStart = performance.now();
      for (let i = 0; i < lookupCount; i++) {
        const line = Math.floor(Math.random() * maxLine);
        checker.isCodeEnabledAtLine(ErrorCodes.unusedLocalDefinition, line);
      }
      const lookupTime = performance.now() - lookupStart;

      console.log('\n[Lookup Performance]');
      console.log(`  ${lookupCount} random lookups: ${lookupTime.toFixed(2)} ms`);
      console.log(`  Average lookup: ${(lookupTime / lookupCount * 1000).toFixed(3)} µs`);

      // Verify some specific behaviors
      expect(result.commentCount).toBeGreaterThan(0);
      expect(result.disabledRanges.length).toBeGreaterThan(0);
    });

    it('should correctly identify disabled lines from next-line comments', () => {
      console.log('\n=== NEXT-LINE COMMENT DETECTION TEST ===\n');

      const cached = analyzer.analyze(mediumDoc1);
      const maxLine = mediumDoc1.lineCount;

      const { checker, result } = createDiagnosticChecker(cached.root!, maxLine);

      // Find next-line disabled ranges (single line ranges)
      const nextLineRanges = result.disabledRanges.filter(
        r => r.startLine === r.endLine,
      );

      console.log('[Next-line Ranges]');
      console.log(`  Found ${nextLineRanges.length} next-line disabled ranges`);

      // Check a few next-line ranges
      for (const range of nextLineRanges.slice(0, 5)) {
        const line = range.startLine;
        const code = range.code;
        const isDisabled = !checker.isCodeEnabledAtLine(code, line);
        const isEnabledBefore = checker.isCodeEnabledAtLine(code, line - 2);
        const isEnabledAfter = checker.isCodeEnabledAtLine(code, line + 1);

        console.log(`  Line ${line}: code ${code} disabled=${isDisabled}, before=${isEnabledBefore}, after=${isEnabledAfter}`);

        // Next-line should be disabled on that specific line
        expect(isDisabled).toBe(true);
      }
    });

    it('should correctly identify disabled ranges from block comments', () => {
      console.log('\n=== BLOCK DISABLE/ENABLE COMMENT DETECTION TEST ===\n');

      const cached = analyzer.analyze(mediumDoc1);
      const maxLine = mediumDoc1.lineCount;

      const { checker, result } = createDiagnosticChecker(cached.root!, maxLine);

      // Find block ranges (multi-line ranges)
      const blockRanges = result.disabledRanges.filter(
        r => r.startLine !== r.endLine,
      );

      console.log('[Block Disabled Ranges]');
      console.log(`  Found ${blockRanges.length} block disabled ranges`);

      // Check a few block ranges
      for (const range of blockRanges.slice(0, 5)) {
        const startLine = range.startLine;
        const endLine = range.endLine === -1 ? maxLine : range.endLine;
        const code = range.code;

        const isDisabledInRange = !checker.isCodeEnabledAtLine(code, startLine + 1);
        const isEnabledBefore = startLine > 0 ? checker.isCodeEnabledAtLine(code, startLine - 1) : true;
        const isEnabledAfter = endLine < maxLine ? checker.isCodeEnabledAtLine(code, endLine + 1) : true;

        console.log(`  Lines ${startLine}-${endLine}: code ${code}`);
        console.log(`    Inside range disabled: ${isDisabledInRange}`);
        console.log(`    Before range enabled: ${isEnabledBefore}`);
        console.log(`    After range enabled: ${isEnabledAfter}`);
      }
    });

    it('should compare old handler vs new range checker performance', () => {
      console.log('\n=== OLD VS NEW HANDLER COMPARISON ===\n');

      const cached = analyzer.analyze(mediumDoc1);
      const maxLine = mediumDoc1.lineCount;

      // New approach: pre-compute ranges
      const newStart = performance.now();
      const { checker, result } = createDiagnosticChecker(cached.root!, maxLine);
      const newSetupTime = performance.now() - newStart;

      console.log('[New Approach - Pre-computed Ranges]');
      console.log(`  Setup time: ${newSetupTime.toFixed(2)} ms`);
      console.log(`  Ranges computed: ${result.disabledRanges.length}`);

      // Simulate many lookups (like during diagnostic iteration)
      const lookupIterations = maxLine;
      const codes = [
        ErrorCodes.unusedLocalDefinition,
        ErrorCodes.unreachableCode,
        ErrorCodes.usedUnviersalDefinition,
      ];

      const newLookupStart = performance.now();
      let newEnabledCount = 0;
      for (let line = 0; line < lookupIterations; line++) {
        for (const code of codes) {
          if (checker.isCodeEnabledAtLine(code as ErrorCodes.CodeTypes, line)) {
            newEnabledCount++;
          }
        }
      }
      const newLookupTime = performance.now() - newLookupStart;

      console.log(`  Lookup time (${lookupIterations} lines × ${codes.length} codes): ${newLookupTime.toFixed(2)} ms`);
      console.log(`  Total enabled checks: ${newEnabledCount}`);

      // Summary
      console.log('\n[Summary]');
      console.log(`  Total new approach time: ${(newSetupTime + newLookupTime).toFixed(2)} ms`);
      console.log(`  Pre-computation overhead: ${newSetupTime.toFixed(2)} ms`);
      console.log('  This overhead is paid once, then all lookups are O(1)');
    });

    it('should handle cascading/overlapping disable comments correctly', () => {
      console.log('\n=== CASCADING DISABLE TEST ===\n');

      // Create a test document with cascading disables
      const cascadingCode = [
        '#!/usr/bin/env fish',                           // line 0
        'echo "line 1 - all enabled"',                   // line 1
        '# @fish-lsp-disable 1001',                      // line 2: disable 1001
        'echo "line 3 - 1001 disabled"',                 // line 3
        'echo "line 4 - 1001 still disabled"',           // line 4
        '# @fish-lsp-disable 1002',                      // line 5: also disable 1002
        'echo "line 6 - 1001 AND 1002 disabled"',        // line 6
        'echo "line 7 - both still disabled"',           // line 7
        '# @fish-lsp-enable 1001',                       // line 8: re-enable only 1001
        'echo "line 9 - only 1002 disabled"',            // line 9
        'echo "line 10 - only 1002 still disabled"',     // line 10
        '# @fish-lsp-enable',                            // line 11: re-enable all
        'echo "line 12 - all enabled again"',            // line 12
      ].join('\n');

      const cascadingDoc = LspDocument.create('file:///test/cascading.fish', 'fish', 1, cascadingCode);
      const cached = analyzer.analyze(cascadingDoc);
      const maxLine = cascadingDoc.lineCount;

      const { checker, result } = createDiagnosticChecker(cached.root!, maxLine);

      console.log('[Computed Ranges]');
      console.log(`  Total ranges: ${result.disabledRanges.length}`);
      for (const range of result.disabledRanges) {
        console.log(`  Code ${range.code}: lines ${range.startLine}-${range.endLine}`);
      }

      console.log('\n[Line-by-Line State]');
      for (let line = 0; line <= 12; line++) {
        const state = checker.getLineState(line);
        const disabled1001 = !checker.isCodeEnabledAtLine(1001 as ErrorCodes.CodeTypes, line);
        const disabled1002 = !checker.isCodeEnabledAtLine(1002 as ErrorCodes.CodeTypes, line);
        console.log(`  Line ${line.toString().padStart(2)}: 1001=${disabled1001 ? 'OFF' : 'ON '} 1002=${disabled1002 ? 'OFF' : 'ON '}`);
      }

      // Verify cascading behavior
      console.log('\n[Verification]');

      // Line 1: all enabled
      expect(checker.isCodeEnabledAtLine(1001 as ErrorCodes.CodeTypes, 1)).toBe(true);
      expect(checker.isCodeEnabledAtLine(1002 as ErrorCodes.CodeTypes, 1)).toBe(true);
      console.log('  ✓ Line 1: both 1001 and 1002 enabled');

      // Line 3: only 1001 disabled
      expect(checker.isCodeEnabledAtLine(1001 as ErrorCodes.CodeTypes, 3)).toBe(false);
      expect(checker.isCodeEnabledAtLine(1002 as ErrorCodes.CodeTypes, 3)).toBe(true);
      console.log('  ✓ Line 3: 1001 disabled, 1002 enabled');

      // Line 6: both disabled (cascading)
      expect(checker.isCodeEnabledAtLine(1001 as ErrorCodes.CodeTypes, 6)).toBe(false);
      expect(checker.isCodeEnabledAtLine(1002 as ErrorCodes.CodeTypes, 6)).toBe(false);
      console.log('  ✓ Line 6: both 1001 and 1002 disabled (cascading)');

      // Line 9: only 1002 disabled (1001 re-enabled)
      expect(checker.isCodeEnabledAtLine(1001 as ErrorCodes.CodeTypes, 9)).toBe(true);
      expect(checker.isCodeEnabledAtLine(1002 as ErrorCodes.CodeTypes, 9)).toBe(false);
      console.log('  ✓ Line 9: 1001 enabled (re-enabled), 1002 still disabled');

      // Line 12: all enabled again
      expect(checker.isCodeEnabledAtLine(1001 as ErrorCodes.CodeTypes, 12)).toBe(true);
      expect(checker.isCodeEnabledAtLine(1002 as ErrorCodes.CodeTypes, 12)).toBe(true);
      console.log('  ✓ Line 12: both 1001 and 1002 enabled again');
    });

    it.only('should handle invalid diagnostic codes gracefully', async () => {
      console.log('\n=== INVALID DIAGNOSTIC CODES TEST ===\n');
      const diagnostics: Diagnostic[] = [];
      const cached = analyzer.analyze(mediumDoc1).ensureParsed();
      const { root, document: doc } = cached;
      const { checker, result } = createDiagnosticChecker(root, doc.lineCount);
      const symbols = analyzer.getFlatDocumentSymbols(mediumDoc1.uri);
      const { variables, functions, events }: {
        variables: FishSymbol[];
        functions: FishSymbol[];
        events: FishSymbol[];
      } = { variables: [], functions: [], events: [] };
      for (const sym of symbols) {
        if (sym.isVariable()) {
          variables.push(sym);
        } else if (sym.isFunction()) {
          functions.push(sym);
        } else if (sym.isEvent()) {
          events.push(sym);
        }
      }
      const unused = allUnusedLocalReferences(doc);
      const kinds = createSymbolKindLookup();
      unused.forEach((s) => {
        if (!checker.isCodeEnabledAtLine(ErrorCodes.unusedLocalDefinition, s.focusedNode.startPosition.row)) {
          return;
        }
        if (s.isExported() || !s.needsLocalReferences()) {
          return;
        }
        // const refs = getReferences(s.document, s.toPosition());
        // if (refs.length === 0) {
        diagnostics.push(FishDiagnostic.create(
          ErrorCodes.unusedLocalDefinition,
          s.focusedNode,
          `The local ${kinds[s.kind]} '${s.name}' is defined but never used.`,
        ));
      });
      variables.forEach((v) => {
        if (!checker.isCodeEnabledAtLine(ErrorCodes.usedUnviersalDefinition, v.focusedNode.startPosition.row)) {
          return;
        }
        if (v.options.some((o) => o.isOption('-U', '--universal'))) {
          diagnostics.push(FishDiagnostic.create(
            ErrorCodes.unusedLocalDefinition,
            v.focusedNode,
          ));
        }
      });
      functions.forEach((f) => {
        if (!checker.isCodeEnabledAtLine(ErrorCodes.functionNameUsingReservedKeyword, f.focusedNode.startPosition.row)) {
          return;
        }
        if (isBuiltin(f.name)) {
          diagnostics.push(FishDiagnostic.create(
            ErrorCodes.functionNameUsingReservedKeyword,
            f.focusedNode,
          ));
        }
      });
      // nodesGen(root).forEach(async (n) => {
      //
      //
      // });
    });
  });
});
