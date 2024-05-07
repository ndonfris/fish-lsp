import helperCommands from '../../snippets/helper_commands.json'
import variableHighlights from '../../snippets/syntax_highlighting_variables.json'
import statusVariables from '../../snippets/status_variable.json'
import envVariables from '../../snippets/env_variables.json'
import localeVariables from '../../snippets/locale_variables.json'
import specialVariables from '../../snippets/special_variables.json'
import pagerHighlights from '../../snippets/pager_colors.json'
import pipeCharacters from '../../snippets/pipe_snippets.json'
import usrEnvVariables from '../../snippets/usr_env_variables.json'

export type KeyValuePair = {
  name: string
  description: string
}

export type CommandHelper = {
  name: string
  description: string
  url: string
}

const commands = () => {
  const map: Map<string, CommandHelper> = new Map<string, CommandHelper>()
  Object.values(helperCommands).forEach((obj: KeyValuePair) => {
    map.set(obj.name, {
      name: obj.name,
      description: obj.description, 
      url: `https://fishshell.com/docs/current/cmds/${obj.name}.html`
    })
  })
  return map
}


const highlightVariables = () : Map<string, KeyValuePair> => {
  const map: Map<string, KeyValuePair> = new Map<string, KeyValuePair>()
  Object.values(pagerHighlights).forEach((obj: KeyValuePair) => {
    map.set(obj.name, obj)
  })
  Object.values(variableHighlights).forEach((obj: KeyValuePair) => {
    map.set(obj.name, obj)
  })
  return map
}



const statusNumbers = () : Map<string, KeyValuePair> => {
  const map: Map<string, KeyValuePair> = new Map<string, KeyValuePair>()
  Object.values(statusVariables).forEach((obj: KeyValuePair) => {
    map.set(obj.name, obj)
  })
  return map
} 


const userEnvVariables = (): Map<string, KeyValuePair> => {
  const map: Map<string, KeyValuePair> = new Map<string, KeyValuePair>()
  Object.values(usrEnvVariables).forEach((obj: KeyValuePair) => {
    map.set(obj.name, obj)
  })
  return map
} 


const specialVars = () : Map<string, KeyValuePair> => {
  const map: Map<string, KeyValuePair> = new Map<string, KeyValuePair>()
  Object.values(envVariables).forEach((obj: KeyValuePair) => {
    map.set(obj.name, obj)
  })
  Object.values(localeVariables).forEach((obj: KeyValuePair) => {
    map.set(obj.name, obj)
  })                            
  Object.values(specialVariables).forEach((obj: KeyValuePair) => {
    map.set(obj.name, obj)
  })                             
  Object.values(usrEnvVariables).forEach((obj: KeyValuePair) => {
    map.set(obj.name, obj)
  })
  return map
}               


const pipeVars = (): Map<string, KeyValuePair> => {
  const map: Map<string, KeyValuePair> = new Map<string, KeyValuePair>()
  Object.values(pipeCharacters).forEach((obj: KeyValuePair) => {
    map.set(obj.name, obj)
  })
  return map
}

export function printFromSnippetVariables(map: Map<string, KeyValuePair>, flags: string = '-gx') {
  const result: string[] = [];
  map.forEach((value, _) => {
    result.push(
      `# ${value.description}`,
      `set ${flags} ${value.name}`,
      ''
    );
  })
  return result;
}

export const Snippets = {
  pipes: pipeVars,
  status: statusNumbers,
  specialVars: specialVars,
  themeVars: highlightVariables,
  userEnvVariables: userEnvVariables,
  commands: commands
}