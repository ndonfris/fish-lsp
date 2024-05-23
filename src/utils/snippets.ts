// import pagerHighlightVariablesJson from '../../snippets/pager_colors.json'
import helperCommandsJson from '../../snippets/helperCommands.json';
import themeVariablesJson from '../../snippets/syntaxHighlightingVariables.json';
import statusNumbersJson from '../../snippets/statusNumbers.json';
import envVariablesJson from '../../snippets/envVariables.json';
import localeVariablesJson from '../../snippets/localeVariables.json';
import specialVariablesJson from '../../snippets/specialFishVariables.json';
import pipeCharactersJson from '../../snippets/pipesAndRedirects.json';
import fishlspEnvVariablesJson from '../../snippets/fishlspEnvVariables.json';

// import PACKAGE from '@package'
//
// console.log(PACKAGE)

interface BaseJson {
  name: string;
  description: string;
}

type JsonType = 'command' | 'pipe' | 'status' | 'variable';
type SpecialType = 'fishlsp' | 'env' | 'locale' | 'special' | 'theme';

interface ExtendedBaseJson extends BaseJson {
  type: JsonType;
  specialType: SpecialType | undefined;
  // otherTypes: string[]; //TODO
}

namespace ExtendedBaseJson {
  export function create(o: BaseJson, type: JsonType, specialType?: SpecialType): ExtendedBaseJson {
    return {
      ...o,
      type,
      specialType,
      // otherTypes: [type],
    };
  }
}

class DocumentationMap {
  private map: Map<string, ExtendedBaseJson[]> = new Map();
  private typeMap: Map<JsonType, ExtendedBaseJson[]> = new Map();

  constructor(data: ExtendedBaseJson[]) {
    data.forEach(item => {
      const curr = this.map.get(item.name) || [];
      // if (this.map.has(item.name)) return
      curr.push(item);
      this.map.set(item.name, curr);
      if (!this.typeMap.has(item.type)) this.typeMap.set(item.type, []);
      this.typeMap.get(item.type)!.push(item);
    });
  }

  getByName(name: string): ExtendedBaseJson[] {
    return name.startsWith('$')
      ? this.map.get(name.slice(1)) || []
      : this.map.get(name) || [];
  }

  getByType(type: JsonType, specialType?: SpecialType): ExtendedBaseJson[] {
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

  findMatchingNames(query: string, ...types: (JsonType | SpecialType)[]): ExtendedBaseJson[] {
    const results: ExtendedBaseJson[] = [];
    this.map.forEach(items => {
      if (items.filter(item => item.name.startsWith(query) && (types.length === 0 || types.includes(item.type || item.specialType)))) {
        results.push(...items);
      }
    });
    return results;
  }

  // Additional helper methods can be added as needed
}

const allData: ExtendedBaseJson[] = [
  ...helperCommandsJson.map((item: BaseJson) => ExtendedBaseJson.create(item, 'command')),
  ...pipeCharactersJson.map((item: BaseJson) => ExtendedBaseJson.create(item, 'pipe')),
  ...statusNumbersJson.map((item: BaseJson) => ExtendedBaseJson.create(item, 'status')),
  ...themeVariablesJson.map((item: BaseJson) => ExtendedBaseJson.create(item, 'variable', 'theme')),
  ...fishlspEnvVariablesJson.map((item: BaseJson) => ExtendedBaseJson.create(item, 'variable', 'fishlsp')),
  ...envVariablesJson.map((item: BaseJson) => ExtendedBaseJson.create(item, 'variable', 'env')),
  ...localeVariablesJson.map((item: BaseJson) => ExtendedBaseJson.create(item, 'variable', 'locale')),
  ...specialVariablesJson.map((item: BaseJson) => ExtendedBaseJson.create(item, 'variable', 'special')),
];

export const PrebuiltDocumentationMap = new DocumentationMap(allData);

export function getPrebuiltDocUrlByName(name: string): string {
  const objs = PrebuiltDocumentationMap.getByName(name);
  const res: string[] = [];
  objs.forEach((obj, index) => {
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
