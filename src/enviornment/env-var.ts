// import { WString } from './wchar';
import { DocumentUri } from 'vscode-languageserver';
import { SyntaxNode } from 'web-tree-sitter';
// import { EnvModeModifier } from '../utils/env';

/**
 * NOTES:
 * ~~~~~~
 *  • scope descriptions:
 *     > 1. Universal
 *     > 2. Global
 *     > 3. Local (which should really be "block-scoped")
 *     > 4. Function-local (which is the same as block-scoped outside of a block!)
 *     > 5. Undefined scope (which is function-local inside of functions, global outside)
 *     > @faho, https://github.com/fish-shell/fish-shell/pull/8145#issuecomment-885767724
 *
 *  • variable scopes use smallest scope that contains the variable
 *     > Conceptually we should not think of "function-local" but just "function variables" to avoid confusion.
 *     > A local variable is local to the innermost block;
 *     > if that block is a function it is a function variable.
 *     > Local variables become the "advanced" case.
 *     > @ridiculousfish https://github.com/fish-shell/fish-shell/pull/8145#pullrequestreview-715292911
 *
 *  • variable scope - https://fishshell.com/docs/current/language.html#variable-scope
 *  • function heavy lifting - https://github.com/fish-shell/fish-shell/blob/81ff6db62dbcb17749491b783f030e4277577bec/src/builtins/function.rs#L251
 *  • function properties - https://github.com/fish-shell/fish-shell/blob/81ff6db62dbcb17749491b783f030e4277577bec/src/function.rs#L23
 *  • environment - https://github.com/fish-shell/fish-shell/blob/master/src/env/environment.rs
 *  • environment impl: https://github.com/fish-shell/fish-shell/blob/master/src/env/environment_impl.rs
 */

const Modifier = {
  ['LOCAL']: 1 << 0,
  ['FUNCTION']: 1 << 1,
  ['GLOBAL']: 1 << 2,
  ['UNIVERSAL']: 1 << 3,
  ['EXPORT']: 1 << 4,
  ['UNEXPORT']: 1 << 5,
  ['PATHVAR']: 1 << 6,
  ['UNPATHVAR']: 1 << 7,
  ['USER']: 1 << 8,
} as const;

export type ModifierKeys = keyof typeof Modifier;
export type ModifierValues = typeof Modifier[ModifierKeys];
export type ModifierCreateResult = { [key in Lowercase<ModifierKeys>]: () => EnvModifier; };

const reverseModifier: { [key: ModifierValues]: ModifierKeys; } =
  Object.entries(Modifier).reduce((acc, [key, value]) => {
    acc[value] = key as ModifierKeys;
    return acc;
  }, {} as { [key in ModifierValues]: ModifierKeys; });

export class EnvModifier {
  /// Flag for local (to the current block) variable.
  public static LOCAL = Modifier.LOCAL;
  public static FUNCTION = Modifier.FUNCTION;
  /// Flag for global variable.
  public static GLOBAL = Modifier.GLOBAL;
  /// Flag for universal variable.
  public static UNIVERSAL = Modifier.UNIVERSAL;
  /// Flag for exported (to commands) variable.
  public static EXPORT = Modifier.EXPORT;
  /// Flag for unexported variable.
  public static UNEXPORT = Modifier.UNEXPORT;
  /// Flag to mark a variable as a path variable.
  public static PATHVAR = Modifier.PATHVAR;
  /// Flag to unmark a variable as a path variable.
  public static UNPATHVAR = Modifier.UNPATHVAR;
  /// Flag for variable update request from the user. All variable changes that are made directly
  /// by the user, such as those from the `read` and `set` builtin must have this flag set. It
  /// serves one purpose = to indicate that an error should be returned if the user is attempting
  /// to modify a var that should not be modified by direct user action; e.g., a read-only var.
  public static USER = Modifier.USER;

  constructor(private mode: ModifierValues) { }

  set value(mode: ModifierValues) {
    this.mode = mode;
  }

  clear() {
    this.mode = 0;
  }

  isLocal() {
    return !!(this.mode & Modifier.LOCAL);
  }

  isFunction() {
    return !!(this.mode & Modifier.FUNCTION);
  }

  isGlobal() {
    return !!(this.mode & Modifier.GLOBAL);
  }

  isUniversal() {
    return !!(this.mode & Modifier.UNIVERSAL);
  }

  public static name(value: ModifierValues): ModifierKeys {
    return reverseModifier[value] as ModifierKeys;
  }

  public static value(name: ModifierKeys) {
    return Modifier[name];
  }

  public static create(): ModifierCreateResult {
    return {
      local: () => new EnvModifier(Modifier.LOCAL),
      function: () => new EnvModifier(Modifier.FUNCTION),
      global: () => new EnvModifier(Modifier.GLOBAL),
      universal: () => new EnvModifier(Modifier.UNIVERSAL),
      export: () => new EnvModifier(Modifier.EXPORT),
      unexport: () => new EnvModifier(Modifier.UNEXPORT),
      pathvar: () => new EnvModifier(Modifier.PATHVAR),
      unpathvar: () => new EnvModifier(Modifier.UNPATHVAR),
      user: () => new EnvModifier(Modifier.USER),
    };
  }
}

export class Symbol {
  constructor(
    public name: string,
    public kind: 'VARIABLE' | 'FUNCTION' | 'ALIAS' | 'BLOCK',
    public modifier: EnvModifier,
    public node: SyntaxNode | null = null,
  ) { }
}

export class EnvVar {
  private values: string[];
  private uri: DocumentUri;
  private mode: EnvModifier;
  private definition: SyntaxNode | null;
  private references: Set<SyntaxNode>;

  constructor(values: string[], uri: DocumentUri | null, mode: EnvModifier, definition: SyntaxNode | null = null) {
    this.values = values;
    this.uri = uri || '';
    this.mode = mode;
    this.definition = definition;
    this.references = new Set();
  }

  getValues(): string[] {
    return [...this.values];
  }

  setValues(...values: string[]): void {
    this.values = values;
  }

  getMode(): EnvModifier {
    return this.mode;
  }

  setMode(mode: EnvModifier): void {
    this.mode = mode;
  }

  getDefinition(): SyntaxNode | null {
    return this.definition;
  }

  setDefinition(node: SyntaxNode): void {
    this.definition = node;
  }

  addReference(node: SyntaxNode): void {
    this.references.add(node);
  }

  getReferences(): Set<SyntaxNode> {
    return new Set(this.references);
  }

  clone(): EnvVar {
    const cloned = new EnvVar(this.values, this.uri, this.mode, this.definition);
    cloned.references = new Set(this.references);
    return cloned;
  }
}

/* TODO: Implement a VarTable class that stores */
export class VarTable {
  private table: Map<string, EnvVar>;

  constructor() {
    this.table = new Map();
  }

  set(key: string, value: EnvVar): void {
    this.table.set(key, value);
  }

  get(key: string): EnvVar | undefined {
    return this.table.get(key);
  }

  has(key: string): boolean {
    return this.table.has(key);
  }

  delete(key: string): boolean {
    return this.table.delete(key);
  }

  clear(): void {
    this.table.clear();
  }

  entries(): IterableIterator<[string, EnvVar]> {
    return this.table.entries();
  }

  keys(): IterableIterator<string> {
    return this.table.keys();
  }

  values(): IterableIterator<EnvVar> {
    return this.table.values();
  }

  size(): number {
    return this.table.size;
  }

  // Additional methods for working with SyntaxNodes

  setWithNode(key: string, values: string[], uri: DocumentUri | null, mode: EnvModifier, definitionNode: SyntaxNode): void {
    const envVar = new EnvVar(values, uri, mode, definitionNode);
    this.set(key, envVar);
  }

  addReference(key: string, referenceNode: SyntaxNode): void {
    const envVar = this.get(key);
    if (envVar) {
      envVar.addReference(referenceNode);
    }
  }

  getDefinitionNode(key: string): SyntaxNode | null {
    const envVar = this.get(key);
    return envVar ? envVar.getDefinition() : null;
  }

  getReferenceNodes(key: string): Set<SyntaxNode> {
    const envVar = this.get(key);
    return envVar ? envVar.getReferences() : new Set();
  }

  getAllDefinitions(): Map<string, SyntaxNode> {
    const definitions = new Map<string, SyntaxNode>();
    for (const [key, value] of this.table) {
      const def = value.getDefinition();
      if (def) {
        definitions.set(key, def);
      }
    }
    return definitions;
  }

  getAllReferences(): Map<string, Set<SyntaxNode>> {
    const references = new Map<string, Set<SyntaxNode>>();
    for (const [key, value] of this.table) {
      references.set(key, value.getReferences());
    }
    return references;
  }
}

export const UniversalEnv = new VarTable();

// Example usage:
// function demonstrateUsage() {
//   const varTable = new VarTable();
//
//   // Creating a mock SyntaxNode (you'd replace this with your actual SyntaxNode implementation)
//   class MockSyntaxNode implements SyntaxNode {
//     constructor(public id: number) { }
//     // ... other required methods
//   }
//
//   // Setting a variable with a definition
//   const defNode = new MockSyntaxNode(1);
//   varTable.setWithNode('PATH', ['usr/local/bin', '/usr/bin'], EnvMode.EXPORT | EnvMode.PATHVAR, defNode);
//
//   // Adding references
//   const refNode1 = new MockSyntaxNode(2);
//   const refNode2 = new MockSyntaxNode(3);
//   varTable.addReference('PATH', refNode1);
//   varTable.addReference('PATH', refNode2);
//
//   // Retrieving variable information
//   const pathVar = varTable.get('PATH');
//   if (pathVar) {
//     console.log('PATH value:', pathVar.getValue());
//     console.log('PATH is exported:', pathVar.isExported());
//     console.log('PATH is path variable:', pathVar.isPathVar());
//     console.log('PATH definition node:', pathVar.getDefinition());
//     console.log('PATH reference nodes:', pathVar.getReferences());
//   }
//
//   // Getting all definitions and references
//   console.log('All definitions:', varTable.getAllDefinitions());
//   console.log('All references:', varTable.getAllReferences());
// }
//
// demonstrateUsage();