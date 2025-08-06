// ANSI color utilities for terminal output
import { relative } from 'path';

// Helper to convert absolute paths to relative paths from project root
export function toRelativePath(filePath: string): string {
  return relative(process.cwd(), filePath);
}

export const colors = {
  // Basic colors
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  
  // Text colors
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',
  
  // Background colors
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
  bgMagenta: '\x1b[45m',
  bgCyan: '\x1b[46m',
  bgWhite: '\x1b[47m',
};

// Check if we should use colors (respects NO_COLOR env var and TTY detection)
const shouldUseColors = !process.env.NO_COLOR && process.stdout.isTTY;

export function colorize(text: string, color: string): string {
  if (!shouldUseColors) return text;
  return `${color}${text}${colors.reset}`;
}

// Utility functions for common color patterns
export const logger = {
  success: (text: string) => colorize(text, colors.green),
  error: (text: string) => colorize(text, colors.red),
  warning: (text: string) => colorize(text, colors.yellow),
  info: (text: string) => colorize(text, colors.blue),
  debug: (text: string) => colorize(text, colors.gray),
  highlight: (text: string) => colorize(text, colors.cyan),
  bold: (text: string) => colorize(text, colors.bright),
  dim: (text: string) => colorize(text, colors.dim),
  
  // Status indicators
  building: (target: string) => `${colorize('⚡', colors.yellow)} Building ${colorize(target, colors.cyan)}...`,
  watching: (target: string) => `${colorize(' ', colors.blue)} Watching ${colorize(target, colors.cyan)} for changes...`,
  complete: (target: string) => `${colorize('✅', colors.green)} ${colorize(target, colors.cyan)} build complete!`,
  failed: (target: string) => `${colorize('❌', colors.red)} ${colorize(target, colors.cyan)} build failed!`,
  
  // File operations
  copied: (from: string, to?: string) => `${colorize('📋', colors.cyan)} Copied ${colorize(toRelativePath(from), colors.dim)}${to ? ` → ${colorize(toRelativePath(to), colors.dim)}` : ''}`,
  generated: (file: string) => `${colorize(' ', colors.cyan)} Generated ${colorize(toRelativePath(file), colors.dim)}`,
  executable: (file: string) => `${colorize(' ', colors.green)} Made executable: ${colorize(toRelativePath(file), colors.dim)}`,
  
  // Statistics
  size: (label: string, size: string, path?: string) => {
    const sizeColored = colorize(size, colors.yellow);
    const labelColored = colorize(label, colors.cyan);
    const pathColored = path ? colorize(path, colors.dim) : '';
    return `${colorize('📦', colors.blue)} ${labelColored} size: ${sizeColored}${path ? ` (${pathColored})` : ''}`;
  },
  
  // Progress indicators
  step: (current: number, total: number, description: string) => {
    const progress = colorize(`[${current}/${total}]`, colors.white);
    const desc = colorize(description, colors.cyan);
    return `${progress} ${desc}`;
  },
  
  // Headers and sections
  header: (text: string) => colorize(`\n${text}`, colors.bright + colors.cyan),
  section: (text: string) => colorize(text, colors.bright),
  
  // Raw logging with color support
  log: (message: string, color?: keyof typeof colors) => {
    const colored = color ? colorize(message, colors[color]) : message;
    console.log(colored);
  },
  
  // Error handling
  warn: (message: string) => console.warn(colorize(`⚠️  ${message}`, colors.yellow)),
  logError: (message: string, error?: Error) => {
    console.error(colorize(`❌ ${message}`, colors.red));
    if (error && process.env.DEBUG) {
      console.error(colorize(error.stack || error.message, colors.red + colors.dim));
    }
  }
};
