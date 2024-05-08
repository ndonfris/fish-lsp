import { homedir } from 'os';
import { ServerLogsPath } from '../logger';
import { CodeAction } from 'vscode-languageserver-protocol';
import { z } from 'zod'

// Define a Zod schema for the configuration
export const ServerPreferencesSchema = z.object({
  hirearchicalDocumentSymbolSupport: z.boolean().default(true),
  asciiArt: z.object({
    enable: z.boolean().default(true)
  }),
  completions: z.object({
    enable: z.boolean().default(true),
    functions: z.boolean().default(true),
    variables: z.boolean().default(true),
    extraDetails: z.boolean().default(true),
    expandAbbreviations: z.object({
      enabled: z.boolean().default(true),
      keys: z.array(z.string()).default([';', ' ', '\t']),
    }),
  }),
  documentation: z.object({
    enable: z.boolean().default(true),
    fallbackCommands: z.array(z.any()).default([]),
  }),
  formatting: z.object({
    tabSize: z.number().default(4),
    trimTrailingWhitespace: z.boolean().default(true),
    trimFinalNewlines: z.boolean().default(true),
    insertFinalNewline: z.boolean().default(true),
    removeLeadingSwitchCaseWhitespace: z.boolean().default(true),
  }),
  workspaces: z.object({
    symbols: z.object({
      enable: z.boolean().default(true),
      max: z.number().default(5000),
      prefer: z.string().default('functions'),
    }),
    paths: z.object({
      defaults: z.array(z.string()).default([
        `${homedir()}/.config/fish`,
        '/usr/share/fish',
      ]),
      allowRename: z.array(z.string()).default([
        `${homedir()}/.config/fish`,
      ]),
    }),
  }),
  codeActions: z.object({
    enable: z.boolean().default(true),
    //create: z.object({
    //  completionsFile: z.boolean().default(false),
    //  fromArgParse: z.boolean().default(false),
    //}),
    //extract: z.object({
    //  toPrivateFunction: z.boolean().default(false),
    //  toLocalVariable: z.boolean().default(false),
    //}),
    //quickfix: z.object({
    //  addMissingEnd: z.boolean().default(true),
    //  removeUnnecessaryEnd: z.boolean().default(true),
    //}),
  }),
  // diagnostics: z.object({
  //   enable: z.boolean().default(true),
  //   maxNumberOfProblems: z.number().default(10),
  // }),
  // logging: z.object({
  //   enable: z.boolean().default(true),
  //   file: z.string().default(ServerLogsPath)
  // }),
  // renames: z.object({
  //   enable: z.boolean().default(true)
  // }),
  // definitions: z.object({
  //   enable: z.boolean().default(true)
  // }),
  // references: z.object({
  //   enable: z.boolean().default(true)
  // }),
});

export type ServerPreferences = z.infer<typeof ServerPreferencesSchema>;

function parseDotKeys(...keys: string[]): string[] {
  const result : string[] = [];
  for (const key of keys) {
    if (key.includes('.')) {
      result.push(...key.split('.'));
    } else {
      result.push(key);
    }
  }
  return result;
}

function buildDotKeys(obj: any) {
  const result: string[] = [];
  for (const key in obj) {
    if (typeof obj[key] === 'object') {
      for (const subkey of buildDotKeys(obj[key])) {
        result.push(`${key}.${subkey}`);
      }
    } else {
      result.push(key);
    }
  }
  return result;
}

export class ConfigMap {
  public obj: any = {};
  public static readonly configNames: string[] = [
    'asciiArt',
    'formatting',
    'logging',
    'snippets',
    'complete',
    'hover',
    'rename',
    'definition',
    'references',
    'diagnostics',
    'signatureHelp',
    'codeAction',
    'index',
  ];

  consructor() {}

  setValueFromKeys(value: any, ...keys: string[]): void {
    const fixedKeys = parseDotKeys(...keys);
    // console.log(fixedKeys.length, keys.length, keys, fixedKeys, value)
    fixedKeys.reduce((acc, key, index) => {
      if (index === fixedKeys.length - 1) {
        acc[key] = value;
      } else {
        acc[key] = acc[key] || {};
      }
      return acc[key];
    }, this.obj);
  }

  setKV(key: string, value: any): void {
    this.setValueFromKeys(value, key);
  }

  toggleFeature(feature: string, value: boolean = true): void {
    this.setValueFromKeys({ enabled: value }, feature);
  }

  getToplevelKeys(): string[] {
    return Array.from(Object.keys(this.obj));
  }

  log(): void {
    console.log('-'.repeat(80));
    console.log('ConfigMap');
    console.log(JSON.stringify(this.obj, null, 2));
  }

  setup(enable: boolean = true) {
    for (const option of ConfigMap.configNames) {
      this.toggleFeature(option, enable);
    }
    return this;
  }

  getValue(...keys: string[]): any {
    const fixedKeys = parseDotKeys(...keys);
    return fixedKeys.reduce((acc, key) => {
      return acc[key];
    }, this.obj);
  }

  getKeysStrs(): string[] {
    return buildDotKeys(this.obj);
  }
}

export function bareStartupManger() {
  const map = new ConfigMap();

  return map.setup(false);
}

export function mainStartupManager() {
  const map = new ConfigMap();
  return map.setup(true);
}