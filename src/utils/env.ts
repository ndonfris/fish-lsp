import { SyntaxNode } from 'web-tree-sitter';
import { getChildrenArguments } from './tree-sitter';
import { DocumentUri } from 'vscode-languageserver';
import { isMatchingOption } from './node-types';

export enum EnvModeModifier {
  /// Flag for local (to the current block) variable.
  LOCAL = 1 << 0,
  FUNCTION = 1 << 1,
  /// Flag for global variable.
  GLOBAL = 1 << 2,
  /// Flag for universal variable.
  UNIVERSAL = 1 << 3,
  /// Flag for exported (to commands) variable.
  EXPORT = 1 << 4,
  /// Flag for unexported variable.
  UNEXPORT = 1 << 5,
  /// Flag to mark a variable as a path variable.
  PATHVAR = 1 << 6,
  /// Flag to unmark a variable as a path variable.
  UNPATHVAR = 1 << 7,
  /// Flag for variable update request from the user. All variable changes that are made directly
  /// by the user, such as those from the `read` and `set` builtin must have this flag set. It
  /// serves one purpose = to indicate that an error should be returned if the user is attempting
  /// to modify a var that should not be modified by direct user action; e.g., a read-only var.
  USER = 1 << 8,
}

type EnvModifierKey = keyof typeof EnvModeModifier;
type EnvModifierValue = typeof EnvModeModifier[EnvModifierKey];

export const EnvModeModifierNames: Record<keyof EnvModifierValue, EnvModifierKey> = {
  [EnvModeModifier.LOCAL]: 'LOCAL',
  [EnvModeModifier.FUNCTION]: 'FUNCTION',
  [EnvModeModifier.GLOBAL]: 'GLOBAL',
  [EnvModeModifier.UNIVERSAL]: 'UNIVERSAL',
  [EnvModeModifier.EXPORT]: 'EXPORT',
  [EnvModeModifier.UNEXPORT]: 'UNEXPORT',
  [EnvModeModifier.PATHVAR]: 'PATHVAR',
  [EnvModeModifier.UNPATHVAR]: 'UNPATHVAR',
  [EnvModeModifier.USER]: 'USER',
} as const;

export namespace EnvModeModifier {
  export function getName(value: number): EnvModifierKey | undefined {
    return EnvModeModifierNames[value as keyof EnvModifierValue];
  }

  export function getValue(key: EnvModifierKey): EnvModifierValue {
    return EnvModeModifier[key];
  }
}

export class EnvNode {
  constructor(
    public mode: EnvModeModifier = EnvModeModifier.LOCAL,
    public node: SyntaxNode | null = null,
  ) { }

  public add(mode: EnvModeModifier) {
    this.mode |= mode;
  }

  public has(mode: EnvModeModifier) {
    return (this.mode & mode) === mode;
  }

  public clear() {
    this.mode &= ~this.mode;
  }

  public clone() {
    return new EnvNode(this.mode);
  }

  public isLocal() {
    return this.mode.valueOf() === EnvModeModifier.LOCAL;
  }

  public isFunction() {
    return this.mode.valueOf() === EnvModeModifier.FUNCTION;
  }

  public isGlobal() {
    return this.mode.valueOf() >= EnvModeModifier.GLOBAL;
  }

  public isUniversal() {
    return this.mode.valueOf() === EnvModeModifier.UNIVERSAL;
  }

  public iter() {
  }
}

export class EnvStack {
  inner: EnvStack;
  canPushPop: boolean;
  dispatchesVarChanges: boolean;
  constructor() {
    this.inner = new EnvStack();
    this.canPushPop = true;
    this.dispatchesVarChanges = false;
  }

  static globals() {
    return new EnvStack();
  }
}

export const uEnv = new EnvNode(EnvModeModifier.UNIVERSAL);

function functionEnvType(uri: DocumentUri, node: SyntaxNode) {
  if (node.type === 'function_declaration') {
    if (uri.split('.').pop() === node.text) {
      return EnvModeModifier.GLOBAL;
    } else if (node.parent?.type === 'function_declaration') {
      return EnvModeModifier.FUNCTION;
    }
  }
  return EnvModeModifier.LOCAL;
}

export function createFunctionEnv(uri: DocumentUri, node: SyntaxNode) {
  const args = getChildrenArguments(node);
  const env = new EnvNode(functionEnvType(uri, node));
  args.forEach((arg) => {
    switch (true) {
      case isMatchingOption(arg, { shortOption: '-V', longOption: '--inherit-variable' }):
        return arg?.nextSibling?.text === arg?.text;
      case isMatchingOption(arg, { shortOption: '-S', longOption: '--no-scope-shadowing' }):
        return true;
      default:
        return false;
    }
  });



}