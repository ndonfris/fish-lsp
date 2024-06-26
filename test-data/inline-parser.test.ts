
import { setLogger } from './helpers';
import { initializeParser } from '../src/parser';
import Parser, { SyntaxNode } from 'web-tree-sitter';
import { ChildProcess, exec, spawn } from 'child_process';
import { promisify } from 'util';
import { Writable } from 'stream';

import { CompletionItem } from 'vscode-languageserver';

// jest.setTimeout(5000); // Increase the timeout if necessary
// import { Writable } from 'stream';

// import { promisify } from 'util';
const execAsync = promisify(exec);

function createJob(): ChildProcess {
  const fishJob = spawn('fish', ['-ic', 'while read val -P ""; complete -C "$val"; echo FISH_COMPLETION_END; end'], {
    stdio: ['pipe', 'pipe', 'ignore'],
  });

  return fishJob;
}

function handleStream(
  stream: NodeJS.ReadableStream | null,
  callback: (data: string) => void,
  endCallback: () => void,
): void {
  if (stream) {
    stream.on('data', (data) => {
      const lines: string[] = data.toString().split('\n');
      lines.forEach((line: string) => {
        if (line !== '') {
          callback(line);
        }
      });
    });
    stream.on('end', endCallback);
  }
}

function handleStderr(fishJob: ChildProcess): void {
  if (fishJob.stderr) {
    fishJob.stderr.on('data', (data) => {
      console.error(`stderr: ${data}`);
    });
  }
}

function handleClose(fishJob: ChildProcess): void {
  // fishJob.on('close', (code) => {
  //   // console.log(`fish process exited with code ${code}`);
  // });
}

function processOutput(outputBuffer: string[]): string[] {
  return outputBuffer.map((item) => {
    const index = item.indexOf('\t');
    if (index !== -1) {
      const label = item.substring(0, index);
      const detail = item.substring(index + 1);
      return `${label} (${detail})`;
    }
    return item;
  });
}

export async function testCompletion(input: string): Promise<string[]> {
  const fishJob = createJob();
  const outputBuffer: string[] = [];

  return new Promise((resolve, reject) => {
    handleStream(fishJob.stdout, (line) => {
      if (line === 'FISH_COMPLETION_END') {
        resolve(processOutput(outputBuffer));
      } else {
        outputBuffer.push(line);
      }
    }, () => resolve(processOutput(outputBuffer)));

    handleStderr(fishJob);
    handleClose(fishJob);

    if (!fishJob.stdin) {
      reject(new Error('stdin is not available'));
    } else {
      const stdin: Writable = fishJob.stdin;
      const writeAsync = promisify(stdin.write.bind(stdin)) as (chunk: any, encoding?: BufferEncoding) => Promise<void>;
      writeAsync(input + '\n')
        .then(() => stdin.end())
        .catch(reject);
    }
  });
}

function processExecOutput(output: string): string[] {
  return output.split('\n')
    .filter(item => item.trim() !== '')
    .map((item) => {
      const index = item.indexOf('\t');
      if (index !== -1) {
        const label = item.substring(0, index);
        const detail = item.substring(index + 1);
        return `${label} (${detail})`;
      }
      return item;
    });
}

export async function testExecCompletion(input: string): Promise<string[]> {
  try {
    const { stdout, stderr } = await execAsync(`echo '${input.replace(/'/g, '\'\\\'\'')}' | fish -ic 'while read val -P ""; complete -C "$val"; end'`);
    if (stderr) {
      console.error(`stderr: ${stderr}`);
    }
    return processExecOutput(stdout);
  } catch (error) {
    console.error('Error executing command:', error);
    throw error;
  }
}

//
//
// Traversal
//
//
// function* customTraversal(cursor: TreeCursor): Generator<SyntaxNode> {
//     do {
//         yield cursor.currentNode;
//         if (cursor.gotoFirstChild()) {
//             yield* customTraversal(cursor);
//             cursor.gotoParent(); // go back to the parent after traversing children
//         }
//     } while (cursor.gotoNextSibling());
// }
//
// async function traverseCustom(input: string) {
//     const traverseParser = await initializeParser();
//     const tree = traverseParser.parse(input);
//     const cursor = tree.rootNode.walk();
//
//     for (const node of customTraversal(cursor)) {
//         console.log(node.type, node.text);
//     }
// }
//
// //
// //
// // Custom Completion Targets
// //
// //
// //
// function extractCompletionTargets(node: Parser.SyntaxNode): string[] {
//   const targets: string[] = [];
//
//   function traverse(node: Parser.SyntaxNode) {
//     if (node.type === 'command' || node.type === 'variable_name' || node.type === 'argument' || node.type === 'function') {
//       targets.push(node.type+":"+node.text);
//     }
//     for (let i = 0; i < node.childCount; i++) {
//       const current = node.child(i)
//       if (current) traverse(current);
//     }
//   }
//
//   traverse(node);
//   return targets;
// }

// async function parseForCompletion(input: string) {
//   const cmpParser = await initializeParser();
//   const tree = cmpParser.parse(input);
//   const rootNode = tree.rootNode;
//
//   if (!rootNode) return;
//
//   const targets = extractCompletionTargets(rootNode);
//
//   console.log(JSON.stringify({"Line": input, 'Completion Targets': targets}, null, 2));
// }

// async function parseCommandLine(input: string) {
//   const cparser = await initializeParser();
//   const tree = cparser.parse(input);
//   const rootNode = tree.rootNode;
//
//   if (!rootNode) return;
//
//   // Assume the cursor is at the end of the input
//   const cursorPosition = input.length-1;
//
//   // Find the node at the cursor position
//   const currentNode = rootNode.descendantForIndex(cursorPosition);
//
//   if (currentNode) {
//     const functionNode = findPreviousProcess(currentNode);
//     console.log('Previous Function Keyword Node:', functionNode?.text);
//   }
// }

function findPreviousProcess(node: Parser.SyntaxNode): Parser.SyntaxNode | null {
  let current: SyntaxNode | null = node;
  while (current && !isProcess(current)) {
    current = getPreviousNode(current);
  }
  console.log('currentPROC', current?.text || 'null');
  return current && isProcess(current) ? current : null;
}

function getPreviousNode(node: Parser.SyntaxNode): Parser.SyntaxNode | null {
  let current: SyntaxNode | null = node;

  while (current) {
    if (isProcess(current)) {
      current = current.previousSibling || current.parent;
    } else {
      break;
    }
  }

  // Traverse to the previous sibling or parent if no previous sibling exists
  if (current && current.previousSibling) {
    return current.previousSibling;
  } else if (current && current.parent) {
    return current.parent;
  }
  return null;
}

function isProcess(node: Parser.SyntaxNode): boolean {
  const processTypes = ['pipe', 'redirect_statement', 'subshell', '&&', '||', ';', 'function', 'command', 'for', 'while', 'if', 'switch', 'case'];
  return processTypes.includes(node.type) || node.type.endsWith('statement');
}

async function parseCommandLine(input: string) {
  const parser = await initializeParser();
  const tree = parser.parse(input);
  const rootNode = tree.rootNode;

  if (!rootNode) return;

  // Assume the cursor is at the end of the input
  const cursorPosition = input.length;

  // Find the node at the cursor position
  const currentNode = rootNode.descendantForIndex(cursorPosition);

  if (currentNode) {
    const currentLine = getLineAtPosition(input, cursorPosition);
    const combinedLines = getCombinedLines(input, cursorPosition);

    console.log('Combined Lines for Completion:', combinedLines);
    // Use the combined lines for completions
    parseForCompletion(combinedLines);
  }
}

function getLineAtPosition(input: string, position: number): string {
  const lines = input.split('\n');
  let lineIndex = 0;
  let charCount = 0;

  for (let i = 0; i < lines.length; i++) {
    charCount += lines[i]!.length + 1; // +1 for newline character
    if (charCount > position) {
      lineIndex = i;
      break;
    }
  }

  return lines[lineIndex] || '';
}

function getCombinedLines(input: string, position: number): string {
  const lines = input.split('\n');
  let lineIndex = 0;
  let charCount = 0;
  let combinedLines = '';

  for (let i = 0; i < lines.length; i++) {
    charCount += lines[i]!.length + 1; // +1 for newline character
    if (charCount > position) {
      lineIndex = i;
      break;
    }
  }

  // Combine lines upwards until no trailing backslash
  for (let i = lineIndex - 1; i >= 0; i--) {
    if (lines[i]!.endsWith('\\')) {
      combinedLines = lines[i]!.slice(0, -1) + combinedLines;
    } else {
      break;
    }
  }

  combinedLines += lines[lineIndex]; // Add the current line
  return combinedLines;
}
//
// Function to get Fish shell completion
async function getFishCompletion(scriptContent: string): Promise<string> {
  // const command = `echo '${scriptContent.replace(/'/g, "'\\''")}' | fish -c 'source (string trim --right \\n); complete -C ""'`;
  const command = `fish -c "string escape \'${scriptContent.replace(/'/g, '\'\\\'\'')}\' | read -t -a cmd; complete -C "$cmd"'`;
  try {
    const { stdout, stderr } = await execAsync(command);
    if (stderr) {
      return '';
    }
    return stdout;
  } catch (e) {
    console.log(e);
  }
  return '';
}

// Function to parse the completion result from Fish shell into LSP CompletionItems
function parseCompletionItems(completionResult: string): CompletionItem[] {
  return completionResult
    .split('\n')
    .filter((item) => item)
    .map((item) => ({
      label: item,
      kind: 1, // 1 is for Text in LSP CompletionItemKind
    }));
}

function parseForCompletion(line: string) {
  // Here you can implement your logic to use the line for completions
  console.log('Parsing line for completion:', line);
}

setLogger();
// Example usage: Simulating a command line for autocompletion
// const commandLine = 'echo "hello" && l';
// parseForCompletion(commandLine);
describe('inline-parser test suite', () => {
  it('test inline-parser normal', async () => {
    const input = 'function \\\\n --';
    const result = await testCompletion(input);
    console.log(result);
    expect(result).toContain('--argument-names (Specify named arguments)');
    expect(result).toContain('--description (Set function description)');
    expect(result).toContain('--inherit-variable (Snapshot and define local variable)');
    expect(result).toContain('--no-scope-shadowing (Do not shadow variable scope of calling function)');
    expect(result).toContain('--on-event (Make the function a generic event handler)');
    expect(result).toContain('--on-job-exit (Make the function a job exit event handler)');
    expect(result).toContain('--on-process-exit (Make the function a process exit event handler)');
    expect(result).toContain('--on-signal (Make the function a signal event handler)');
    expect(result).toContain('--on-variable (Make the function a variable update event handler)');
    expect(result).toContain('--wraps (Inherit completions from the given command)');
    // expect(true).toBeTruthy()
  });
});

it('test exec inline-parser normal', async () => {
  const input = 'function --';
  const result = await testExecCompletion(input);
  console.log(result);

  // expect(result).toContain('--argument-names (Specify named arguments)');
  // expect(result).toContain('--description (Set function description)');
  // expect(result).toContain('--inherit-variable (Snapshot and define local variable)');
  // expect(result).toContain('--no-scope-shadowing (Do not shadow variable scope of calling function)');
  // expect(result).toContain('--on-event (Make the function a generic event handler)');
  // expect(result).toContain('--on-job-exit (Make the function a job exit event handler)');
  // expect(result).toContain('--on-process-exit (Make the function a process exit event handler)');
  // expect(result).toContain('--on-signal (Make the function a signal event handler)');
  // expect(result).toContain('--on-variable (Make the function a variable update event handler)');
  // expect(result).toContain('--wraps (Inherit completions from the given command)');
  // expect(true).toBeTruthy()
});

it('source and `function foo \\ --argument`', async () => {
  // const fishSource = new fishSource();
  // // Does NOT Work!!
  // const result = await fishSource.sendLines(['function foo \\', '--argument']);
  // expect(result).toContain('--argument-names (Specify named arguments)');
  // expect(result).toContain('--description (Set function description)');
  // expect(result).toContain('--inherit-variable (Snapshot and define local variable)');
  // expect(result).toContain('--no-scope-shadowing (Do not shadow variable scope of calling function)');
  // expect(result).toContain('--on-event (Make the function a generic event handler)');
  // expect(result).toContain('--on-job-exit (Make the function a job exit event handler)');
  // expect(result).toContain('--on-process-exit (Make the function a process exit event handler)');
  // expect(result).toContain('--on-signal (Make the function a signal event handler)');
  // expect(result).toContain('--on-variable (Make the function a variable update event handler)');
  // expect(result).toContain('--wraps (Inherit completions from the given command)');
  // console.log(result);
});

// input.forEach(async line => {
// const tree = parser.parse(line);
// const {rootNode} = tree
// const lastLeaf = getLastLeaf(rootNode)
//
// const prev = findPreviousProcess(lastLeaf)
//
// console.log(`lastLeaf: '${lastLeaf.text}', type: ${lastLeaf.type}`);
// console.log(`process: '${prev?.text || 'null'}'`);
//
// console.log('____');
// await parseCommandLine(line);

// });
//   console.log({text: node.text, grammarId: node.grammarId, typeId: node.typeId, grammarType: node.grammarType, normalType: node.type, fieldName: parser.getLanguage().fieldNameForId(node.grammarId)})
//   console.log();
//   if (node.type === 'option' || node.type === 'argument') {
//     console.log('Has argument!!!!');
//   }
//
// }
// console.log();
// const res = await traverseCustom(line)
// console.log(res);
// console.log(parser.getLanguage());

// await parseCommandLine(line)
// console.log();

// const children = getChildNodes(rootNode);
// const lastChild = getLeafs(rootNode).pop()!;
//
// let current: SyntaxNode | null = lastChild;
// while (current && !startNodes.includes(current.type)) {
//   current = current.previousSibling;
// }
// if (current) {
//   console.log('commandNode', current.text, current.type);
// }

// if (line.startsWith('function')) {

// console.log('-'.repeat(Number.parseInt(process.env.COLUMNS || '80')));
// console.log({line});
// for (const child of children) {
//   console.log({text: child.text, type: child.type, grammarType: child.grammarType});
// }

// console.log({
//   firstChild: rootNode.firstChild?.text || '',
//   lastChild: rootNode.fieldNameForChild(-1) || ''
// });
// const outputLine = inline.parseCommand(line)
// console.log(outputLine.command);