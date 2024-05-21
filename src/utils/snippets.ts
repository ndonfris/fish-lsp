import helperCommandsJson from '../../snippets/helper_commands.json';
import themeVariablesJson from '../../snippets/syntax_highlighting_variables.json';
// import pagerHighlightVariablesJson from '../../snippets/pager_colors.json'
import statusNumbersJson from '../../snippets/status_numbers.json';
import envVariablesJson from '../../snippets/env_variables.json';
import localeVariablesJson from '../../snippets/locale_variables.json';
import specialVariablesJson from '../../snippets/special_fish_variables.json';
import pipeCharactersJson from '../../snippets/pipes_and_redirects.json';
import fishlspEnvVariablesJson from '../../snippets/fish_lsp_env_variables.json';


interface BaseJson {
  name: string;
  description: string;
}

type JsonType = 'command' | 'pipe' | 'status' | 'variable'
type SpecialType = 'fishlsp' | 'env' | 'locale' | 'special' | 'theme';

interface ExtendedBaseJson extends BaseJson {
  type: JsonType;
  specialType: SpecialType | undefined;
  // otherTypes: string[]; //TODO
}

namespace ExtendedBaseJson {
  export function create(o: BaseJson, type: JsonType, specialType?: SpecialType):  ExtendedBaseJson {
    return {
      ...o,
      type,
      specialType,
      // otherTypes: [type],
    }
  }
}

class DocumentationMap {
  private map: Map<string, ExtendedBaseJson[]> = new Map();
  private typeMap: Map<JsonType, ExtendedBaseJson[]> = new Map();

  constructor(data: ExtendedBaseJson[]) {
    data.forEach(item => {
      const curr = this.map.get(item.name) || []
      // if (this.map.has(item.name)) return
      curr.push(item)
      this.map.set(item.name, curr);
      if (!this.typeMap.has(item.type)) this.typeMap.set(item.type, []);
      this.typeMap.get(item.type)!.push(item);
    });
  }

  getByName(name: string): ExtendedBaseJson[] {
    return name.startsWith('$')
      ? this.map.get(name.slice(1)) || []
      : this.map.get(name) || []
  }

  getByType(type: JsonType, specialType?: SpecialType): ExtendedBaseJson[] {
    const allOfType = this.typeMap.get(type) || []; 
    return specialType !== undefined 
      ? allOfType.filter(v => v?.specialType === specialType)
      : allOfType
  }

  add(item: ExtendedBaseJson): void {
    const curr = this.map.get(item.name) || []
    curr?.push(item)
    this.map.set(item.name, curr);
    if (!this.typeMap.has(item.type))  this.typeMap.set(item.type, []) 
    this.typeMap.get(item.type)!.push(item);
  }

  findMatchingNames(query: string, ...types: (JsonType | SpecialType)[]): ExtendedBaseJson[] {
    const results: ExtendedBaseJson[] = [];
    this.map.forEach(items => {
      if (items.filter(item => item.name.startsWith(query) && (types.length === 0 || types.includes(item.type || item.specialType)))) {
        results.push(...items);
      }
    })
    return results;
  }

  // Additional helper methods can be added as needed
}

const allData: ExtendedBaseJson[] = [
  ...helperCommandsJson.map((item: BaseJson) => ExtendedBaseJson.create(item, 'command')),
  ...pipeCharactersJson.map((item: BaseJson) => ExtendedBaseJson.create(item, 'pipe')),
  ...statusNumbersJson.map((item: BaseJson) =>  ExtendedBaseJson.create(item, 'status')),
  ...themeVariablesJson.map((item: BaseJson) => ExtendedBaseJson.create(item, 'variable', 'theme')),
  ...fishlspEnvVariablesJson.map((item: BaseJson) => ExtendedBaseJson.create( item, 'variable', 'fishlsp' )),
  ...envVariablesJson.map((item: BaseJson) => ExtendedBaseJson.create(item, 'variable', 'env')),
  ...localeVariablesJson.map((item: BaseJson) => ExtendedBaseJson.create( item, 'variable', 'locale' )),
  ...specialVariablesJson.map((item: BaseJson) => ExtendedBaseJson.create( item, 'variable', 'special' )),
];

export const prebuiltDocumentationMap = new DocumentationMap(allData);

export function getPrebuiltDocUrlByName(name: string): string {
  const objs = prebuiltDocumentationMap.getByName(name)
  const res: string[] = []
  objs.forEach(obj => {
   res.push(getPrebuiltDocUrl(obj))
  })
  return res.join('\n')
}

export function getPrebuiltDocUrl(obj: ExtendedBaseJson): string {
  switch (obj.type) {
    case 'command':
      return `https://fishshell.com/docs/current/cmds/${obj.name}.html`
    case 'pipe':
      return 'https://fishshell.com/docs/current/language.html#input-output-redirection'
    case 'status':
      return 'https://fishshell.com/docs/current/language.html#variables-status'
    case 'variable':
    default:
      break;
  }

  // variable links 
  switch (obj.specialType) {
    // case 'fishlsp'
    case 'env':
      return `https://fishshell.com/docs/current/language.html#envvar-${obj.name}`
    case 'locale':
      return `https://fishshell.com/docs/current/language.html#locale-variables-${obj.name}`
    case 'theme':
      // return 'https://fishshell.com/docs/current/interactive.html#variables-color'
      return `https://fishshell.com/docs/current/language.html#envvar-${obj.name}`
    case 'special':
      return `https://fishshell.com/docs/current/language.html#envvar-${obj.name}`
      // return 'https://fishshell.com/docs/current/language.html#special-variables'
    default:
      return ''
  }
}

