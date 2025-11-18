// import pagerHighlightVariablesJson from '../../snippets/pager_colors.json'
import helperCommandsJson from '../snippets/helperCommands.json';
import themeVariablesJson from '../snippets/syntaxHighlightingVariables.json';
import statusNumbersJson from '../snippets/statusNumbers.json';
import envVariablesJson from '../snippets/envVariables.json';
import localeVariablesJson from '../snippets/localeVariables.json';
import specialVariablesJson from '../snippets/specialFishVariables.json';
import pipeCharactersJson from '../snippets/pipesAndRedirects.json';
import fishlspEnvVariablesJson from '../snippets/fishlspEnvVariables.json';
import functionsJson from '../snippets/functions.json';
import { md } from './markdown-builder';

interface BaseJson {
  name: string;
  description: string;
  file?: string;        // Optional: path to function definition file
  flags?: string[];     // Optional: function flags/options
}

type JsonType = 'command' | 'function' | 'pipe' | 'status' | 'variable';
type SpecialType = 'fishlsp' | 'env' | 'locale' | 'special' | 'theme';
type AllTypes = JsonType | SpecialType;

export interface ExtendedBaseJson extends BaseJson {
  type: JsonType;
  specialType: SpecialType | undefined;
}

export namespace ExtendedBaseJson {
  export function create(o: BaseJson, type: JsonType, specialType?: SpecialType): ExtendedBaseJson {
    return {
      ...o,
      type,
      specialType,
    };
  }

  export function is(o: any): o is ExtendedBaseJson {
    return o.type !== undefined && o.exactMatchOptions === undefined;
  }
}

type ValueType = boolean | boolean[] | number | number[] | string | string[];

export type CliObject = {
  name: string;
  valueType: ValueType;
  description: string;
  exactMatchOptions: boolean;
  type: string;
  options: string;
  defaultValue: string;
};

export interface EnvVariableJson extends BaseJson {
  type: JsonType;
  specialType: SpecialType;
  shortDescription: string;
  valueType: 'boolean' | 'number' | 'string' | 'array';
  isDeprecated: boolean;
  exactMatchOptions: boolean;
  options: string;
  defaultValue: string;
}

export namespace EnvVariableJson {
  export function create(o: BaseJson | any, exactMatchOptions: boolean, options: ValueType): EnvVariableJson {
    return {
      ...o,
      type: 'variable',
      specialType: 'fishlsp',
      isDeprecated: o.isDeprecated || false,
      exactMatchOptions,
      options,
    };
  }

  export function is(o: any): o is EnvVariableJson {
    return o.type === 'variable' && o.specialType === 'fishlsp' && o.exactMatchOptions !== undefined;
  }

  const joinValueTypes = (valueType: ValueType = []): string => {
    if (!Array.isArray(valueType)) {
      return String.raw`${valueType}`;
    }
    return valueType.map(v => {
      if (Number.isInteger(v)) {
        return v;
      }
      return "'" + String.raw`${v}` + "'";
    }).join(', ');
  };

  const joinDefaultValue = (valueType: EnvVariableJson['valueType'], defaultValue: ValueType, optionValue: ValueType): string => {
    if (!Array.isArray(defaultValue)) {
      if (valueType === 'string' && defaultValue === '') {
        return `'${defaultValue}'`;
      } else if (valueType === 'number') {
        return `${defaultValue}`;
      } else if (valueType === 'boolean') {
        return `'${defaultValue}'`;
      } else if (valueType === 'array') {
        return '[\'\']';
      } else {
        return '';
      }
    } else {
      if (valueType === 'array' && defaultValue.length === 0) {
        if (Array.isArray(optionValue) && optionValue.some(v => Number.isInteger(v))) {
          return '[]';
        }
        return '[]';
      } else if (valueType === 'array' && defaultValue.length > 0) {
        return '[' + joinValueTypes(defaultValue) + ']';
      }
      return joinValueTypes(defaultValue);
    }
  };

  export function asCliObject(o: EnvVariableJson): CliObject {
    const options = joinValueTypes(o.options);
    const defaultValue = joinDefaultValue(o.valueType, o.defaultValue, o.options);
    return {
      name: o.name,
      valueType: o.valueType,
      description: o.description,
      exactMatchOptions: o.exactMatchOptions,
      type: o.type,
      options,
      defaultValue,
    };
  }

  export function toCliOutput(o: EnvVariableJson, opts: CliToStringOpts = {
    includeType: true,
    includeOptions: true,
    includeDefaultValue: true,
    wrap: true,
  }): string {
    const cli = asCliObject(o);
    return fromCliOutputToString(cli, opts);
  }

  export function toMarkdownString(o: EnvVariableJson, opts: CliToStringOpts = {
    includeType: true,
    includeOptions: true,
    includeDefaultValue: true,
    wrap: true,
  }): string {
    const cli = asCliObject(o);
    return fromCliToMarkdownString(cli, opts);
  }
}

function buildBodySection(subtitle: string, body: string, shouldWrap: boolean = false, asMarkdown: boolean = false): string {
  const hasTitle = () => subtitle.length > 0;
  const titleStr = !hasTitle() ? '' : `(${subtitle}: `;
  const trailingBrace = !hasTitle() ? '' : ')';
  const separator = asMarkdown ? '\n\n' : '\n';

  if (!shouldWrap) return `${titleStr} ${body}${trailingBrace}`;

  const maxLineLength = 76;
  const output: string[] = [];
  let currentLine = titleStr;
  const leftpadBody = !hasTitle() ? '' : ' '.repeat(titleStr.length);

  // handle special case where body is empty or just quotes given for default section
  body = subtitle === 'Default' && ['""', "''", ''].includes(body.trim()) ? "''" : body;
  const splitBody = body.split(' ');
  const addComma = (idx: number) => idx === splitBody.length - 1 ? '' : ',';
  const words = asMarkdown
    ? body.split(' ').map((word, idx) => {
      const newWord = word !== "''" && !Number.isInteger(word) ? word.slice(0, -1) : word;
      if (Number.isInteger(newWord)) return md.inlineCode(newWord) + addComma(idx);
      if (newWord.startsWith("'") && newWord.endsWith("'")) {
        return md.inlineCode(newWord) + addComma(idx);
      }
      return md.inlineCode(word);
    })
    : body.split(' ');
  for (const word of words) {
    if (currentLine.length + word.length + 1 > maxLineLength) {
      output.push(currentLine);
      currentLine = `${leftpadBody}${word} `;
    } else {
      currentLine += `${word} `;
    }
  }
  output.push(currentLine);
  return output.join(separator).trimEnd() + trailingBrace;
}

type CliToStringOpts = {
  includeType?: boolean;
  includeOptions?: boolean;
  includeDefaultValue?: boolean;
  wrap?: boolean;
};

export function fromCliOutputToString(cli: CliObject, opts: CliToStringOpts = {
  includeType: true,
  includeOptions: true,
  includeDefaultValue: true,
  wrap: true,
}): string {
  const title = opts?.includeType ? `$${cli.name} <${cli.valueType.toString().toUpperCase()}>` : cli.name;
  const body: string[] = [];
  body.push(...cli.description.split('\n\n'));
  if (opts.includeOptions) {
    if (cli.exactMatchOptions) {
      body.push(buildBodySection('Options', cli.options, opts.wrap));
    } else {
      body.push(buildBodySection('Example Options', cli.options, opts.wrap));
    }
  }
  if (opts.includeDefaultValue) body.push(buildBodySection('Default', cli.defaultValue, opts.wrap));
  return [
    title,
    ...body.join('\n').trimEnd().split('\n'),
  ].map(line => `# ${line}`).join('\n');
}

export function fromCliToMarkdownString(cli: CliObject, opts: CliToStringOpts = {
  includeType: true,
  includeOptions: true,
  includeDefaultValue: true,
  wrap: true,
}): string {
  const body: string[] = [];
  if (opts.includeOptions) {
    if (cli.exactMatchOptions) {
      body.push(buildBodySection(md.bold('Options'), cli.options, opts.wrap, true));
    } else {
      body.push(buildBodySection(md.bold('Example Options'), cli.options, opts.wrap, true));
    }
  }
  if (opts.includeDefaultValue) body.push(buildBodySection(md.bold('Default'), cli.defaultValue, opts.wrap, true));
  return [
    `(${md.bold(cli.type)}) ${md.inlineCode(cli.name)} <${cli.valueType.toString().toUpperCase()}>`,
    cli.description,
    md.separator(),
    ...body.join('\n\n').trimEnd().split('\n\n'),
  ].join('\n\n');
}

export const fishLspObjs: EnvVariableJson[] = fishlspEnvVariablesJson.map((item: any | BaseJson | Partial<EnvVariableJson>) => EnvVariableJson.create(item, item?.exactMatchOptions, item?.options));

export type ExtendedJson = ExtendedBaseJson | EnvVariableJson;

class DocumentationMap {
  private map: Map<string, ExtendedJson[]> = new Map();
  private typeMap: Map<JsonType, ExtendedJson[]> = new Map();

  constructor(data: ExtendedJson[]) {
    data.forEach(item => {
      const curr = this.map.get(item.name) || [];
      // if (this.map.has(item.name)) return
      curr.push(item);
      this.map.set(item.name, curr);
      if (!this.typeMap.has(item.type)) this.typeMap.set(item.type, []);
      this.typeMap.get(item.type)!.push(item);
    });
  }

  getByName(name: string): ExtendedJson[] {
    return name.startsWith('$')
      ? this.map.get(name.slice(1))?.filter(item => item.type === 'variable') || []
      : this.map.get(name) || [];
  }

  getByType(type: JsonType, specialType?: SpecialType): ExtendedJson[] {
    const allOfType = this.typeMap.get(type) || [];
    return specialType !== undefined
      ? allOfType.filter(v => v?.specialType === specialType)
      : allOfType;
  }

  add(item: ExtendedBaseJson): void {
    const curr = this.map.get(item.name) || [];
    curr?.push(item);
    this.map.set(item.name, curr);
    if (!this.typeMap.has(item.type)) this.typeMap.set(item.type, []);
    this.typeMap.get(item.type)!.push(item);
  }

  findMatchingNames(query: string, ...types: AllTypes[]): ExtendedJson[] {
    const results: ExtendedBaseJson[] = [];
    this.map.forEach(items => {
      if (items.filter(item => item.name.startsWith(query) && (types.length === 0 || types.includes(item.type || item.specialType)))) {
        results.push(...items);
      }
    });
    return results;
  }

  getSpecialVariableAsHoverDoc(name: `$${string}` | string): string {
    const variables = this.getByType('variable');
    const searchStr = name.startsWith('$') ? name.slice(1) : name;
    const needle = searchStr === 'fish_lsp_logfile' ? 'fish_lsp_log_file' : searchStr;
    const result = variables.find(item => item.name === needle);
    if (!result) return '';
    return [
      `(${md.italic('variable')}) - ${md.inlineCode('$' + searchStr)}`,
      md.separator(),
      result.description,
    ].join('\n');
  }

  // Additional helper methods can be added as needed
}

const allData: ExtendedBaseJson[] = [
  ...helperCommandsJson.map((item: BaseJson) => ExtendedBaseJson.create(item, 'command')),
  ...pipeCharactersJson.map((item: BaseJson) => ExtendedBaseJson.create(item, 'pipe')),
  ...statusNumbersJson.map((item: BaseJson) => ExtendedBaseJson.create(item, 'status')),
  ...themeVariablesJson.map((item: BaseJson) => ExtendedBaseJson.create(item, 'variable', 'theme')),
  ...fishlspEnvVariablesJson.map((item: any | BaseJson | EnvVariableJson) => EnvVariableJson.create(item, item?.exactMatchOptions, item?.options)),
  ...envVariablesJson.map((item: BaseJson) => ExtendedBaseJson.create(item, 'variable', 'env')),
  ...localeVariablesJson.map((item: BaseJson) => ExtendedBaseJson.create(item, 'variable', 'locale')),
  ...specialVariablesJson.map((item: BaseJson) => ExtendedBaseJson.create(item, 'variable', 'special')),
  // Fish-shipped functions from functions.json (transform to BaseJson structure)
  // Preserve file and flags fields for browser/tooling use
  ...functionsJson.map((item: any) => ExtendedBaseJson.create({
    name: item.name,
    description: item.description || `Fish function: ${item.name}`,
    file: item.file,
    flags: item.flags,
  }, 'function')),
];

export const PrebuiltDocumentationMap = new DocumentationMap(allData);

export function getPrebuiltDocUrlByName(name: string): string {
  const objs = PrebuiltDocumentationMap.getByName(name);
  const res: string[] = [];
  objs.forEach((obj, _index) => {
    // const linkStr = objs.length > 1 ? new String(index + 1) : ''
    res.push(` - ${getPrebuiltDocUrl(obj)}`);
  });
  return res.join('\n').trim();
}

export function getPrebuiltDocUrl(obj: ExtendedBaseJson): string {
  switch (obj.type) {
    case 'command':
      return `https://fishshell.com/docs/current/cmds/${obj.name}.html`;
    case 'pipe':
      return 'https://fishshell.com/docs/current/language.html#input-output-redirection';
    case 'status':
      return 'https://fishshell.com/docs/current/language.html#variables-status';
    case 'variable':
    default:
      break;
  }

  // variable links
  switch (obj.specialType) {
    // case 'fishlsp'
    case 'env':
      return `https://fishshell.com/docs/current/language.html#envvar-${obj.name}`;
    case 'locale':
      return `https://fishshell.com/docs/current/language.html#locale-variables-${obj.name}`;
    case 'theme':
      // return 'https://fishshell.com/docs/current/interactive.html#variables-color'
      return `https://fishshell.com/docs/current/language.html#envvar-${obj.name}`;
    case 'special':
      return `https://fishshell.com/docs/current/language.html#envvar-${obj.name}`;
    // return 'https://fishshell.com/docs/current/language.html#special-variables'
    default:
      return '';
  }
}
