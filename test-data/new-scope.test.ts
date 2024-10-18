import * as Parser from 'web-tree-sitter';
import { SyntaxNode } from 'web-tree-sitter';
import * as NodeTypes from '../src/utils/node-types';
// import
import { initializeParser } from '../src/parser';
import { getChildNodes, getChildrenArguments } from '../src/utils/tree-sitter';
import { createFakeDocument, setLogger } from './logger-setup';

export const ScopeTag: Record<'LOCAL' | 'FUNCTION' | 'GLOBAL' | 'UNIVERSAL', number> = {
  ['LOCAL']: 1,
  ['FUNCTION']: 2,
  ['GLOBAL']: 3,
  ['UNIVERSAL']: 4,
};

export type ScopeTag = typeof ScopeTag[keyof typeof ScopeTag];

export interface Scope {
  tag: ScopeTag;
  node: SyntaxNode;
}

function getUriScopeType(uri: string) {
  const uriParts = uri.split('/');
  if (uriParts?.at(-2) && uriParts.at(-2)?.includes('functions')) {
    return 'FUNCTION';
  }
  if (uriParts.at(-1) === 'config.fish' || uriParts.at(-2) === 'conf.d') {
    return 'CONFIG';
  }
  return 'SCRIPT';
}

export function getScope(uri: string, node: SyntaxNode) {
  const uriType = getUriScopeType(uri);
  const nodeType = node.type;
  // switch (uriType) {
  //   case 'function':
  //     return getFunctionScope(node);
  //   case 'config':
  //     return getConfigScope(node);
  //   case 'script':
  //     return getScriptScope(node);
  //   default:
  //     return Scope.create(node, ScopeTag.local);
  // }
  //
  // return Scope.create(node, ScopeTag.local);
  return { tag: uriType, node: nodeType };
}

export namespace Scope {
  export function create(scopeTag: ScopeTag, scopeNode: SyntaxNode): Scope {
    return {
      tag: scopeTag,
      node: scopeNode,
    };
  }
}

function getSetScopeVariableDefinitionNode(node: SyntaxNode) {
  const args: SyntaxNode[] = node.parent.childrenForFieldName('argument') || [];
  let definitionNode: SyntaxNode | null = null;
  for (const arg of args) {
    if (NodeTypes.isOption(arg)) {
      continue;
    } else {
      definitionNode = arg;
      break;
    }
  }
  return definitionNode.equals(node);
}

class ReadScope {
  public localVariables: SyntaxNode[] = [];
  public functionVariables: SyntaxNode[] = [];
  public globalVariables: SyntaxNode[] = [];
  public universalVariables: SyntaxNode[] = [];
  public currentModifier: 'local' | 'function' | 'global' | 'universal' = 'local';

  public addVariable(node: SyntaxNode) {
    switch (this.currentModifier) {
      case 'local':
        this.localVariables.push(node);
        break;
      case 'function':
        this.functionVariables.push(node);
        break;
      case 'global':
        this.globalVariables.push(node);
        break;
      case 'universal':
        this.universalVariables.push(node);
        break;
    }
  }

  public setModifier(node: SyntaxNode) {
    switch (true) {
      case NodeTypes.isMatchingOption(node, { shortOption: '-l', longOption: '--local' }):
        this.currentModifier = 'LOCAL';
        break;
      case NodeTypes.isMatchingOption(node, { shortOption: '-f', longOption: '--function' }):
        this.currentModifier = 'FUNCTION';
        break;
      case NodeTypes.isMatchingOption(node, { shortOption: '-g', longOption: '--global' }):
        this.currentModifier = 'GLOBAL';
        break;
      case NodeTypes.isMatchingOption(node, { shortOption: '-U', longOption: '--universal' }):
        this.currentModifier = 'UNIVERSAL';
        break;
      default:
        break;
    }
  }

  public contains(node: SyntaxNode) {
    const doesContain = (nodes: SyntaxNode[]) => nodes.some((n) => n.equals(node));
    return (
      doesContain(this.localVariables) ||
      doesContain(this.functionVariables) ||
      doesContain(this.globalVariables) ||
      doesContain(this.universalVariables)
    );
  }

  public log() {
    this.localVariables.forEach((n, i) => {
      console.log(`local:${i}:${n.text}`);
    });
    this.functionVariables.forEach((n, i) => {
      console.log(`function:${i}:${n.text}`);
    });
    this.globalVariables.forEach((n, i) => {
      console.log(`global:${i}:${n.text}`);
    });
    this.universalVariables.forEach((n, i) => {
      console.log(`universal:${i}:${n.text}`);
    });
  }
}

/**
 * Read can define multiple variables
 */
function getReadScopeVariableDefinitionNode(node: SyntaxNode) {
  const readScope = new ReadScope();
  const args: SyntaxNode[] = node.parent.childrenForFieldName('argument')
    .filter((n) => {
      switch (true) {
        case NodeTypes.isMatchingOption(n, { shortOption: '-l', longOption: '--local' }):
        case NodeTypes.isMatchingOption(n, { shortOption: '-f', longOption: '--function' }):
        case NodeTypes.isMatchingOption(n, { shortOption: '-g', longOption: '--global' }):
        case NodeTypes.isMatchingOption(n, { shortOption: '-U', longOption: '--universal' }):
          readScope.setModifier(n);
          return false;
        case NodeTypes.isMatchingOption(n, { shortOption: '-c', longOption: '--command' }):
          return false;
        case NodeTypes.isMatchingOption(n.previousSibling, { shortOption: '-d', longOption: '--delimiter' }):
        case NodeTypes.isMatchingOption(n, { shortOption: '-d', longOption: '--delimiter' }):
          return false;
        case NodeTypes.isMatchingOption(n.previousSibling, { shortOption: '-n', longOption: '--nchars' }):
        case NodeTypes.isMatchingOption(n, { shortOption: '-n', longOption: '--nchars' }):
          return false;
        case NodeTypes.isMatchingOption(n.previousSibling, { shortOption: '-p', longOption: '--prompt' }):
        case NodeTypes.isMatchingOption(n, { shortOption: '-p', longOption: '--prompt' }):
          return false;
        case NodeTypes.isMatchingOption(n.previousSibling, { shortOption: '-P', longOption: '--prompt-str' }):
        case NodeTypes.isMatchingOption(n, { shortOption: '-P', longOption: '--prompt-str' }):
          return false;
        case NodeTypes.isMatchingOption(n.previousSibling, { shortOption: '-R', longOption: '--right-prompt' }):
        case NodeTypes.isMatchingOption(n, { shortOption: '-R', longOption: '--right-prompt' }):
          return false;
        case NodeTypes.isMatchingOption(n, { shortOption: '-s', longOption: '--silent' }):
        case NodeTypes.isMatchingOption(n, { shortOption: '-S', longOption: '--shell' }):
        case NodeTypes.isMatchingOption(n, { shortOption: '-t', longOption: '--tokenize' }):
        case NodeTypes.isMatchingOption(n, { shortOption: '-u', longOption: '--unexport' }):
        case NodeTypes.isMatchingOption(n, { shortOption: '-x', longOption: '--export' }):
        case NodeTypes.isMatchingOption(n, { shortOption: '-a', longOption: '--list' }):
        case NodeTypes.isMatchingOption(n, { shortOption: '-z', longOption: '--null' }):
        case NodeTypes.isMatchingOption(n, { shortOption: '-L', longOption: '--line' }):
          return false;
        default:
          return true;
      }
    });
  args.forEach((arg) => {
    readScope.addVariable(arg);
  });
  // readScope.log()
  // console.log({index: i, arg: arg.text});
  return readScope.contains(node);
}

function getFunctionArgumentNames(node: SyntaxNode) {
  const args = getChildrenArguments(node.parent);
  const argNames: SyntaxNode[] = [];
  let seenArgumentFlag = false;

  for (const arg of args) {
    if (NodeTypes.isMatchingOption(arg, { shortOption: '-a', longOption: '--argument-names' })) {
      seenArgumentFlag = true;
      continue;
    }
    if (NodeTypes.isOption(arg)) {
      seenArgumentFlag = false;
      break;
    }
    if (!NodeTypes.isOption(arg) && seenArgumentFlag) {
      argNames.push(arg);
      continue;
    }
  }

  return argNames.some((n) => n.equals(node));
}

function getFunctionInheritVariable(node: SyntaxNode) {
  const args = getChildrenArguments(node.parent);
  const argNames: SyntaxNode[] = [];

  const isInheritVariable = (n: SyntaxNode) => {
    return (
      NodeTypes.isMatchingOption(n.previousSibling, { shortOption: '-V', longOption: '--inherit-variable' })
      && !NodeTypes.isOption(n)
    );
  };

  for (const arg of args) {
    if (!arg.previousSibling) return false;
    if (isInheritVariable(arg)) {
      argNames.push(arg);
      break;
    }
  }

  return argNames.some((n) => n.equals(node));
}

function getFunctionOnVariable(node: SyntaxNode) {
  const args = getChildrenArguments(node.parent);
  const argNames: SyntaxNode[] = [];

  const isOnVariable = (n: SyntaxNode) => {
    return (
      NodeTypes.isMatchingOption(n.previousSibling, { shortOption: '-v', longOption: '--on-variable' })
      && !NodeTypes.isOption(n)
    );
  };

  for (const arg of args) {
    if (!arg.previousSibling) return false;
    if (isOnVariable(arg)) {
      argNames.push(arg);
      break;
    }
  }

  return argNames.some((n) => n.equals(node));
}

function getNoScopeShadowing(node: SyntaxNode) {
  const args = getChildrenArguments(node.parent);
  const argNames: SyntaxNode[] = [];

  for (const arg of args) {
    if (!arg.previousSibling) return false;
    if (NodeTypes.isMatchingOption(arg, { shortOption: '-S', longOption: '--no-scope-shadowing' })) {
      argNames.push(arg);
      break;
    }
  }

  return argNames.some((n) => n.equals(node));
}

function getFunctionDescription(node: SyntaxNode) {
  const args = getChildrenArguments(node.parent);
  const argNames: SyntaxNode[] = [];

  for (const arg of args) {
    if (!arg.previousSibling) continue;
    if (
      NodeTypes.isMatchingOption(arg.previousSibling, { shortOption: '-d', longOption: '--description' })
      && !NodeTypes.isOption(arg)
    ) {
      argNames.push(arg);
      break;
    }
  }

  return argNames.some((n) => n.equals(node));
}

describe('new scope', () => {
  let parser: Parser | null = null;

  beforeAll(async () => {
    parser = await initializeParser();
  });

  setLogger(
    async () => {
      if (parser) {
        parser.reset();
      }
    },
  );

  function testSymbolFiltering(filename: string, input: string) {
    const document = createFakeDocument(filename, input);
    const tree = parser.parse(document.getText());
    const { rootNode } = tree;
    const nodes = getChildNodes(rootNode);
    return {
      tree,
      rootNode,
      nodes,
      document,
      input,
    };
  }

  it.only('check definition scope', () => {
    const result = testSymbolFiltering('conf.d/beep.fish', [
      'printf ',
      'status',
      'set -l i 5',
      'set i_no_scope 6',
      'set i_array 6 7 8',
      '',
      'for i in (seq 1 10)',
      '    echo "1:  $i"',
      'end',
      'echo $i | read -f i',
      'echo \'a b c d e\' | read -d \' \' -l _a _b _c _d _e',

      'function foo -a i',
      '    echo $i',
      'end',
      'functions',
    ].join('\n'));

    const isOptionNode = (n: SyntaxNode): boolean => {
      if (NodeTypes.isOption(n)) {
        return true;
      }
      return false;
    };
    const isCommandNode = (n: SyntaxNode): boolean => {
      if (NodeTypes.isCommand(n) || NodeTypes.isCommandName(n)) {
        return true;
      }
      return false;
    };

    result.nodes
      .filter((n: SyntaxNode) => {
        if (!n.parent || !n.isNamed || isOptionNode(n) || isCommandNode(n)) return false;
        return true;
      })
      .forEach((n: SyntaxNode) => {
        if (!n.parent) return;
        if (n.parent.type === 'for_statement' && n.type === 'variable_name' && n.parent.firstNamedChild?.equals(n)) {
          console.log('for', n.text);
          return;
        }

        if (n.isNamed && n.parent.type === 'function_definition') {
          if (n.parent.firstNamedChild?.equals(n)) {
            console.log('function', n.text);
            return;
          }
          return;

          // if (getChildrenArguments(n.parent).some((newNode) => newNode.equals(n))) {
          //   console.log('funcArg', n.text);
          //   return;
          // }
          //
          // if (n.parent.childrenForFieldName('argument')?.at(-2)) {
          //
          //   console.log('funcArg', n.text)
          //   return;
          // }
        }

        if (
          NodeTypes.isNonFlagArgument(n) &&
          NodeTypes.isCommandWithName(n.parent, 'read') &&
          getReadScopeVariableDefinitionNode(n)
        ) {
          console.log('read', n.text);
          return;
        }

        if (
          NodeTypes.isNonFlagArgument(n) &&
          NodeTypes.isCommandWithName(n.parent, 'set') &&
          getSetScopeVariableDefinitionNode(n)
        ) {
          // if (n.parent.childrenForFieldName('argument')?.at(-2)?.equals(n)) {
          //   console.log('set', n.text)
          //   return
          // }
          console.log('set', n.text);
          return;
        }
      });
  });

  it('read definition scope', () => {
    const { nodes } = testSymbolFiltering('conf.d/read_vars.fish', [
      'echo \'a b c d e f g h\' | read -d \' \' -x _a _b _c _d _e _f -g',
    ].join('\n'));

    const result = nodes.filter((n, i) => {
      if (!n.parent) return false;

      if (NodeTypes.isCommandWithName(n.parent, 'read') && getReadScopeVariableDefinitionNode(n)) {
        // console.log(`read:${i}`, n.text)
        return true;
      }
    });

    expect(result.map(n => n.text)).toEqual(['_a', '_b', '_c', '_d', '_e', '_f']);
  });

  it('set definition scope', () => {
    const { nodes } = testSymbolFiltering('conf.d/set_vars.fish', [
      'set -l _a 1',
      'set -g _b 2',
      'set -U _c 3',
      'set -f _d 4',
    ].join('\n'));

    const result = nodes.filter((n, i) => {
      if (!n.parent) return false;

      if (NodeTypes.isCommandWithName(n.parent, 'set') && getSetScopeVariableDefinitionNode(n)) {
        // console.log(`set:${i}`, n.text)
        return true;
      }
      return false;
    });

    expect(result.map(n => n.text)).toEqual(['_a', '_b', '_c', '_d']);
  });

  describe.only('function definition && function --flags modifiers', () => {
    let input: ReturnType<typeof testSymbolFiltering>;
    let nodes: SyntaxNode[] = [];

    beforeEach(async () => {
      input = testSymbolFiltering('functions/foo.fish', [
        'function foo -a _a _b _c _d _e _f -v _g -V _h -S --description "foo function"',
        '    echo $argv',
        'end',
      ].join('\n'));
      nodes = input.nodes;
    });

    afterEach(() => {
      input = {} as ReturnType<typeof testSymbolFiltering>;
      nodes = [] as SyntaxNode[];
    });

    it('function name', () => {
      const result = nodes.filter((n) => {
        if (!n.parent) return false;
        if (n.isNamed && n.parent.type === 'function_definition') {
          if (n.parent.firstNamedChild?.equals(n)) {
            // console.log('function', n.text);
            return true;
          }
        }
        return false;
      });

      expect(result.map(n => n.text)).toEqual(['foo']);
    });

    it('argumentNames', () => {
      const result = nodes.filter((n) => {
        if (!n.parent) return false;
        if (n.isNamed && n.parent.type === 'function_definition') {
          if (getFunctionArgumentNames(n)) {
            // console.log(`funcArg:${i}`, n.text)
            return true;
          }
        }
        return false;
      });

      expect(result.map(n => n.text)).toEqual(['_a', '_b', '_c', '_d', '_e', '_f']);
    });

    it('inheritVariable', () => {
      const result = nodes.filter((n) => {
        if (!n.parent) return false;
        if (n.isNamed && n.parent.type === 'function_definition') {
          if (getFunctionInheritVariable(n)) {
            return true;
          }
        }
        return false;
      });

      expect(result.map(n => n.text)).toEqual(['_h']);
    });

    it('onVariable', () => {
      const result = nodes.filter((n) => {
        if (!n.parent) return false;
        if (n.isNamed && n.parent.type === 'function_definition') {
          if (getFunctionOnVariable(n)) {
            return true;
          }
        }
        return false;
      });

      expect(result.map(n => n.text)).toEqual(['_g']);
    });

    it('noScopeShadowing', () => {
      const result = nodes.filter((n) => {
        if (!n.parent) return false;
        if (n.isNamed && n.parent.type === 'function_definition') {
          if (getNoScopeShadowing(n)) {
            return true;
          }
        }
        return false;
      });

      expect(result.map(n => n.text)).toEqual(['-S']);
    });

    it('description', () => {
      const result = nodes.filter((n) => {
        if (!n.parent) return false;
        if (n.isNamed && n.parent.type === 'function_definition') {
          if (getFunctionDescription(n)) {
            return true;
          }
        }
        return false;
      });

      expect(result.map(n => n.text)).toEqual(['"foo function"']);
    });
  });

  describe.only('function definition scope', () => {
    it('function definition scope', () => {
      const { nodes, document } = testSymbolFiltering('functions/foo.fish', [
        'function foo -a _a _b _c _d _e _f -v _g -V _h -S --description "foo function"',
        '    echo $argv',
        'end',
      ].join('\n'));

      const focusedNode = nodes.find((n) => n.isNamed && n.text === 'foo' && n.parent.type === 'function_definition');
      const uriScope = getUriScopeType(document.uri);

      if (!focusedNode) fail();

      // console.log({ uriScope, focusedNode: focusedNode?.text });
      expect(uriScope).toBe('FUNCTION');
      expect(focusedNode).toBeTruthy();
      expect(focusedNode.text).toBe('foo');

      const scope = getScope(document.uri, focusedNode);
      console.log({
        modifier: scope.tag,
        node: focusedNode.text,
      });
    });
  });
});