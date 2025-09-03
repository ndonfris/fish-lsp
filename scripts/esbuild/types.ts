// Build target type definitions for fish-lsp esbuild system

/**
 * Individual build configuration targets that map to actual build configs
 */
export type BuildConfigTarget = 'binary' | 'development' | 'npm';

/**
 * Meta targets that control the build process behavior
 */
export type MetaTarget = 'all' | 'types' | 'library';

/**
 * All possible build targets that can be passed to the build system
 */
export type BuildTarget = BuildConfigTarget | MetaTarget;

/**
 * Build targets that generate actual output artifacts
 */
export type OutputTarget = BuildConfigTarget;

/**
 * Build targets that have corresponding esbuild configurations
 */
export type ConfiguredTarget = BuildConfigTarget;

/**
 * Targets available when using --all flag (excludes special targets)
 */
export const ALL_TARGETS: readonly BuildConfigTarget[] = ['development', 'binary', 'npm'] as const;

/**
 * All valid CLI targets
 */
export const VALID_TARGETS: readonly BuildTarget[] = [...ALL_TARGETS, 'all', 'types', 'library'] as const;

/**
 * Type guard to check if a string is a valid BuildTarget
 */
export function isValidTarget(target: string): target is BuildTarget {
  return VALID_TARGETS.includes(target as BuildTarget);
}

/**
 * Type guard to check if a target is a build config target (has actual esbuild config)
 */
export function isBuildConfigTarget(target: BuildTarget): target is BuildConfigTarget {
  return ALL_TARGETS.includes(target as BuildConfigTarget);
}

/**
 * Type guard to check if a target is a meta target
 */
export function isMetaTarget(target: BuildTarget): target is MetaTarget {
  return ['all', 'types', 'library'].includes(target as MetaTarget);
}

/**
 * Get the display name for a target
 */
export function getTargetDisplayName(target: BuildTarget): string {
  switch (target) {
    case 'binary': return 'Universal Binary';
    case 'development': return 'Development';
    case 'npm': return 'NPM Package';
    case 'all': return 'All targets';
    case 'types': return 'TypeScript Declarations';
    case 'library': return 'Library';
    default: 
      // This ensures exhaustiveness checking at compile time
      const _exhaustive: never = target;
      return target;
  }
}
