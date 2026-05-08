import { Position, SymbolKind } from 'vscode-languageserver';
import { vi } from 'vitest';
import { analyzer, Analyzer } from '../src/analyze';
import { getHoverForFlag } from '../src/hover';
import { parseInlineVariableAssignment, processInlineVariables } from '../src/parsing/inline-variable';
import { processAliasCommand } from '../src/parsing/alias';
import { processArgparseCommand } from '../src/parsing/argparse';
import { processExportCommand } from '../src/parsing/export';
import { processReadCommand } from '../src/parsing/read';
import { processSetCommand } from '../src/parsing/set';
import { getFunctionSignatureHelp } from '../src/signature';
import { isStructuralKeyword } from '../src/semantic-tokens';
import { md } from '../src/utils/markdown-builder';
import { getCommandNameNode, isCommandName } from '../src/utils/node-types';
import { createFakeLspDocument, setLogger } from './helpers';

vi.mock('../src/utils/exec', async () => {
  const actual = await vi.importActual<typeof import('../src/utils/exec')>('../src/utils/exec');
  return {
    ...actual,
    execCompletions: vi.fn(async (...args: string[]) => {
      if (args[0] === 'echo') {
        return [
          '--help\tShow help',
          '--version\tShow version',
        ];
      }
      return [];
    }),
    execSubCommandCompletions: vi.fn(async () => []),
  };
});

type FakeNode = any;

function createLeaf(type: string, text: string, startColumn: number): FakeNode {
  return {
    type,
    text,
    isNamed: true,
    startIndex: startColumn,
    endIndex: startColumn + text.length,
    startPosition: { row: 0, column: startColumn },
    endPosition: { row: 0, column: startColumn + text.length },
    parent: null,
    children: [],
    namedChildren: [],
    namedChildCount: 0,
    firstChild: null,
    lastChild: null,
    firstNamedChild: null,
    lastNamedChild: null,
    previousSibling: null,
    nextSibling: null,
    previousNamedSibling: null,
    nextNamedSibling: null,
    _fields: {} as Record<string, FakeNode[]>,
    child(index: number) {
      return this.children[index] ?? null;
    },
    namedChild(index: number) {
      return this.namedChildren[index] ?? null;
    },
    childForFieldName(field: string) {
      return this._fields[field]?.[0] ?? null;
    },
    childrenForFieldName(field: string) {
      return this._fields[field] ?? [];
    },
    equals(other: FakeNode) {
      return this === other;
    },
  };
}

function linkChildren(parent: FakeNode, children: FakeNode[]) {
  parent.children = children;
  parent.namedChildren = children.filter(child => child.isNamed);
  parent.namedChildCount = parent.namedChildren.length;
  parent.firstChild = children[0] ?? null;
  parent.lastChild = children.at(-1) ?? null;
  parent.firstNamedChild = parent.namedChildren[0] ?? null;
  parent.lastNamedChild = parent.namedChildren.at(-1) ?? null;

  children.forEach((child, index) => {
    child.parent = parent;
    child.previousSibling = children[index - 1] ?? null;
    child.nextSibling = children[index + 1] ?? null;
  });

  parent.namedChildren.forEach((child: FakeNode, index: number) => {
    child.previousNamedSibling = parent.namedChildren[index - 1] ?? null;
    child.nextNamedSibling = parent.namedChildren[index + 1] ?? null;
  });
}

function attachTree(node: FakeNode, rootNode: FakeNode) {
  node.tree = { rootNode };
  for (const child of node.children) {
    attachTree(child, rootNode);
  }
}

function createContainer(type: string, children: FakeNode[]): FakeNode {
  const startColumn = children[0]?.startPosition.column ?? 0;
  const endColumn = children.at(-1)?.endPosition.column ?? startColumn;
  const node = createLeaf(type, children.map(child => child.text).join(' '), startColumn);
  node.endIndex = endColumn;
  node.endPosition = { row: 0, column: endColumn };
  linkChildren(node, children);
  return node;
}

function createOverrideVariable(name: string, value: string, startColumn: number): FakeNode {
  const nameNode = createLeaf('variable_name', name, startColumn);
  const valueNode = createLeaf('word', value, startColumn + name.length + 1);
  const node = createLeaf('override_variable', `${name}=${value}`, startColumn);
  node._fields = {
    name: [nameNode],
    value: [valueNode],
  };
  linkChildren(node, [nameNode, valueNode]);
  return node;
}

function createCommandNode({
  overrides = [],
  name,
  args = [],
  parentType = 'program',
}: {
  overrides?: Array<{ name: string; value: string; }>;
  name: string;
  args?: string[];
  parentType?: 'program' | 'function_definition';
}) {
  const overrideNodes: FakeNode[] = [];
  let column = 0;

  for (const override of overrides) {
    const overrideNode = createOverrideVariable(override.name, override.value, column);
    overrideNodes.push(overrideNode);
    column = overrideNode.endPosition.column + 1;
  }

  const nameNode = createLeaf('word', name, column);
  column = nameNode.endPosition.column + 1;

  const argumentNodes = args.map((arg) => {
    const node = createLeaf('word', arg, column);
    column = node.endPosition.column + 1;
    return node;
  });

  const commandNode = createLeaf('command', [
    ...overrideNodes.map(node => node.text),
    name,
    ...args,
  ].join(' '), 0);
  commandNode.endIndex = Math.max(0, column - 1);
  commandNode.endPosition = { row: 0, column: Math.max(0, column - 1) };
  commandNode._fields = {
    override: overrideNodes,
    name: [nameNode],
    argument: argumentNodes,
  };
  linkChildren(commandNode, [...overrideNodes, nameNode, ...argumentNodes]);

  const parentNode = createContainer(parentType, [commandNode]);
  attachTree(parentNode, parentNode);
  return {
    parentNode,
    commandNode,
    nameNode,
    overrideNodes,
    argumentNodes,
  };
}

describe('post-PR command-name regressions', () => {
  beforeAll(async () => {
    setLogger();
    await Analyzer.initialize();
  });

  it('uses the `name` field for command-name checks', () => {
    const { commandNode, nameNode } = createCommandNode({
      overrides: [{ name: 'DEBUG', value: '1' }],
      name: 'echo',
      args: ['hello'],
    });

    expect(getCommandNameNode(commandNode)?.text).toBe('echo');
    expect(isCommandName(nameNode)).toBe(true);
    expect(isCommandName(commandNode.namedChildren[0]!)).toBe(false);
  });

  it('parses and extracts inline variables from override nodes', () => {
    const doc = createFakeLspDocument('functions/inline_override.fish', '');
    const { commandNode, overrideNodes } = createCommandNode({
      overrides: [
        { name: 'DEBUG', value: '1' },
        { name: 'NODE_ENV', value: 'test' },
      ],
      name: 'vitest',
      args: ['--run'],
    });

    expect(parseInlineVariableAssignment(overrideNodes[0])).toEqual({
      name: 'DEBUG',
      value: '1',
    });

    const symbols = processInlineVariables(doc, commandNode);
    expect(symbols.map(symbol => symbol.name)).toEqual(['DEBUG', 'NODE_ENV']);
    expect(symbols.map(symbol => symbol.fishKind)).toEqual(['INLINE_VARIABLE', 'INLINE_VARIABLE']);
  });

  it('extracts symbol definitions from override-prefixed parser commands', () => {
    const autoloadedDoc = createFakeLspDocument('functions/override_symbols.fish', '');
    const configDoc = createFakeLspDocument('config.fish', '');

    const setCommand = createCommandNode({
      overrides: [{ name: 'ENV', value: '1' }],
      name: 'set',
      args: ['-g', '-x', 'FEATURE_FLAG', 'on'],
    }).commandNode;
    expect(processSetCommand(configDoc, setCommand).map(symbol => symbol.name)).toEqual(['FEATURE_FLAG']);

    const readCommand = createCommandNode({
      overrides: [{ name: 'ENV', value: '1' }],
      name: 'read',
      args: ['-l', 'first', 'second'],
    }).commandNode;
    expect(processReadCommand(configDoc, readCommand).map(symbol => symbol.name)).toEqual(['first', 'second']);

    const argparseCommand = createCommandNode({
      overrides: [{ name: 'ENV', value: '1' }],
      name: 'argparse',
      args: ['h/help', 'name=', '--', '$argv'],
      parentType: 'function_definition',
    }).commandNode;
    expect(processArgparseCommand(autoloadedDoc, argparseCommand).map(symbol => symbol.name)).toEqual([
      '_flag_h',
      '_flag_help',
      '_flag_name',
    ]);

    const aliasCommand = createCommandNode({
      overrides: [{ name: 'ENV', value: '1' }],
      name: 'alias',
      args: ['ll', "'ls -l'"],
    }).commandNode;
    expect(processAliasCommand(configDoc, aliasCommand).map(symbol => symbol.name)).toEqual(['ll']);

    const exportCommand = createCommandNode({
      overrides: [{ name: 'ENV', value: '1' }],
      name: 'export',
      args: ['PATH=/opt/bin:$PATH'],
    }).commandNode;
    expect(processExportCommand(configDoc, exportCommand).map(symbol => symbol.name)).toEqual(['PATH']);
  });

  it('returns the real command name from commandNameAtPoint()', () => {
    const { argumentNodes } = createCommandNode({
      overrides: [{ name: 'DEBUG', value: '1' }],
      name: 'string',
      args: ['match', '--all'],
    });

    const nodeAtPointSpy = vi.spyOn(analyzer, 'nodeAtPoint').mockReturnValue(argumentNodes[1] as never);
    try {
      expect(analyzer.commandNameAtPoint('file:///test.fish', 0, 0)).toBe('string');
    } finally {
      nodeAtPointSpy.mockRestore();
    }
  });

  it('builds flag hover from the real command name and argument field', async () => {
    const { argumentNodes } = createCommandNode({
      overrides: [{ name: 'DEBUG', value: '1' }],
      name: 'echo',
      args: ['--help'],
    });

    const hover = await getHoverForFlag(argumentNodes[0] as never);
    expect(hover?.contents).toMatchObject({
      kind: 'markdown',
    });
    expect((hover?.contents as any).value).toContain('**echo**');
    expect((hover?.contents as any).value).toContain('--help');
  });

  it('builds function signature help from the real command name', () => {
    const { argumentNodes } = createCommandNode({
      overrides: [{ name: 'ENV', value: 'prod' }],
      name: 'deployctl',
      args: ['staging'],
    });

    const fakeAnalyzer = {
      findSymbol: vi.fn(() => ({
        name: 'deployctl',
        kind: SymbolKind.Function,
        detail: 'Deploy target environment',
        children: [
          {
            fishKind: 'FUNCTION_VARIABLE',
            name: 'target',
            kind: SymbolKind.Variable,
            toMarkupContent: () => ({
              kind: 'markdown',
              value: [
                '(variable) target',
                md.separator(),
                'detail',
                md.separator(),
                'selection',
                md.separator(),
                'usage',
              ].join(''),
            }),
          },
          {
            fishKind: 'FUNCTION_VARIABLE',
            name: 'argv',
            kind: SymbolKind.Variable,
            toMarkupContent: () => ({
              kind: 'markdown',
              value: '',
            }),
          },
        ],
      })),
    };

    const signature = getFunctionSignatureHelp(
      fakeAnalyzer as never,
      argumentNodes[0] as never,
      'ENV=prod deployctl staging',
      Position.create(0, 'ENV=prod deployctl staging'.length),
    );

    expect(signature).not.toBeNull();
    expect(signature?.signatures[0]?.label).toBe('deployctl target $argv[2..-1]');
    expect(signature?.activeParameter).toBe(0);
  });

  it('classifies structural keywords from the command name field', () => {
    const { commandNode } = createCommandNode({
      overrides: [{ name: 'TRACE', value: '1' }],
      name: 'if',
      args: ['test', '1', '-eq', '1'],
    });

    expect(isStructuralKeyword(commandNode)).toBe(true);
  });
});
