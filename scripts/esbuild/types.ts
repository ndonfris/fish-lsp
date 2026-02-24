// Build target type definitions for fish-lsp esbuild system

/**
 * Individual build configuration targets that map to actual build configs
 */
export type BuildConfigTarget = 'binary' | 'development' | 'npm';

/**
 * Meta targets that control the build process behavior
 */
export type MetaTarget = 'all' | 'types' | 'library' | 'test' | 'ci' | 'fresh' | 'setup';

/**
 * All possible build targets that can be passed to the build system
 */
export type BuildTarget = BuildConfigTarget | MetaTarget;

/**
 * Watch/build mode used by file-watcher and CLI --mode flag
 */
export type WatchMode = 'dev' | 'binary' | 'npm' | 'types' | 'all' | 'lint' | 'test' | 'ci' | 'fresh' | 'setup';

/**
 * Sourcemap generation modes
 */
export type SourcemapMode = 'optimized' | 'extended' | 'none' | 'special';

// ============================================================================
// TargetInfo — single source of truth for all target metadata
// ============================================================================

export interface TargetInfo {
  readonly index: number;
  readonly name: string;
  readonly altNames: readonly string[];
  readonly label: string;
  readonly description: string;
  readonly keys: readonly string[];
  readonly type: 'meta' | 'build';
  readonly command: readonly string[];
  /** Color name used in help/mode menus (maps to String prototype color) */
  readonly helpColor: string;
}

export namespace TargetInfo {
  let _idx = 0;

  export function create(
    name: string,
    label: string,
    description: string,
    command: string[],
    helpColor?: string,
    keys?: string[],
    altNames?: string[],
  ): TargetInfo {
    _idx++;
    const buildNames: string[] = ['binary', 'development', 'npm'];
    const isBuild = buildNames.includes(name) || (altNames?.some(a => buildNames.includes(a)) ?? false);
    return {
      index: _idx,
      name,
      altNames: altNames ?? [],
      label,
      description,
      keys: [String(_idx), ...(keys ?? [])],
      type: isBuild ? 'build' : 'meta',
      command,
      helpColor: helpColor ?? 'dim',
    };
  }

  /** Get the single-letter keyboard shortcut (e.g. 'd', 'n', 'b') */
  export function letterKey(info: TargetInfo): string | undefined {
    return info.keys.find(k => /^[a-z]$/i.test(k));
  }

  /** Quick mode summary string: "1:full, 2:npm, 3:lint, ..." */
  export function quickModeSummary(items: readonly TargetInfo[]): string {
    return items.map(t => `${t.index}:${t.label.toLowerCase()}`).join(', ');
  }

  /** Format a help entry with combined index+key: "[4|B]", color name, and description */
  export function helpEntry(info: TargetInfo): { key: string; color: string; text: string } | undefined {
    const letter = letterKey(info);
    if (!letter) return undefined;
    return { key: `[${info.index}|${letter.toUpperCase()}]`, color: info.helpColor, text: info.description };
  }
}

/**
 * All targets with their metadata. Order determines the 1-based index
 * and the numeric keyboard shortcut in watch mode.
 */
export const targets: readonly TargetInfo[] = [
  TargetInfo.create('dev',    'Full',        'Full Project (yarn build)',           ['dev'],             'cyan',      ['d'], ['development']),
  TargetInfo.create('npm',    'NPM',         'NPM Build (yarn dev --npm)',          ['dev', '--npm'],    'yellow',    ['n']),
  TargetInfo.create('lint',   'Lint',         'Lint Fix (yarn lint:fix)',            ['lint:fix'],        'magenta',  ['l']),
  TargetInfo.create('binary', 'Binary',       'Binary Build (yarn dev --binary)',    ['dev', '--binary'], 'blue',     ['b'], ['bin']),
  TargetInfo.create('test',   'Test',         'Test Run (yarn test)',                ['test:run'],        'green',    ['t']),
  TargetInfo.create('types',  'Types',        'Types Build (yarn dev --types)',      ['dev', '--types'],  'white',    ['y']),
  TargetInfo.create('ci',     'CI/CD',        'CI/CD Test (yarn dev --ci)',          ['dev', '--ci'],     'magenta',  ['c']),
  TargetInfo.create('all',    'All Targets',  'All Targets (yarn dev --all)',        ['dev', '--all']),
  TargetInfo.create('fresh',  'Fresh',        'Fresh Install (yarn dev --fresh)',    ['dev', '--fresh']),
  TargetInfo.create('setup',  'Setup',        'Setup (yarn dev --setup)',            ['dev', '--setup']),
];

/** Targets that have keyboard shortcuts in watch mode (index 1-7) */
export const keyboardTargets: readonly TargetInfo[] = targets.filter(t => t.keys.length > 1);

// ============================================================================
// Derived constants
// ============================================================================

export const VALID_WATCH_MODES: readonly string[] = targets.map(t => t.name);
export const VALID_SOURCEMAP_MODES: readonly SourcemapMode[] = ['optimized', 'extended', 'none', 'special'];

// ============================================================================
// Lookup helpers
// ============================================================================

/** Find a target by name, alt name, or keyboard key */
export function findTarget(nameOrKey: string): TargetInfo | undefined {
  return targets.find(t =>
    t.name === nameOrKey ||
    t.altNames.includes(nameOrKey) ||
    t.keys.includes(nameOrKey)
  );
}

/** Get target by its primary name (throws if not found) */
export function getTarget(name: string): TargetInfo {
  const target = targets.find(t => t.name === name);
  if (!target) throw new Error(`Unknown target: ${name}`);
  return target;
}
