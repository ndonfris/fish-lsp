import helperCommands from '../../snippets/helper_commands.json'
import variableHighlights from '../../snippets/syntax_highlighting_variables.json'
import statusVariables from '../../snippets/status_variable.json'
import envVariables from '../../snippets/env_variables.json'
import localeVariables from '../../snippets/locale_variables.json'
import specialVariables from '../../snippets/special_variables.json'
import pagerHighlights from '../../snippets/pager_colors.json'
import pipeCharacters from '../../snippets/pipe_snippets.json'

type KeyValuePair = {
  name: string
  description: string
}

type CommandHelper = {
  name: string
  description: string
  url: string
}

export const commands = () => {
  console.log(helperCommands);
  // const output: {name: string, description: string, url: string}[] = []
  const map: Map<string, CommandHelper> = new Map<string, CommandHelper>()
  Object.values(helperCommands).forEach((obj: KeyValuePair) => {
    // console.log(obj.name);
    map.set(obj.name, {
      name: obj.name,
      description: obj.description, 
      url: `https://fishshell.com/docs/current/cmds/${obj.name}.html`
    })
    // output.push({
    //   name: obj.name,
    //   description: obj.description, 
    //   url: `https://fishshell.com/docs/current/cmds/${obj.name}.html`
    // })
  })
  // console.log(Array.from( map.keys() ).join(','));
  return map
}


export const highlightVariables = () : Map<string, KeyValuePair> => {
  const map: Map<string, KeyValuePair> = new Map<string, KeyValuePair>()
  Object.values(pagerHighlights).forEach((obj: KeyValuePair) => {
    map.set(obj.name, obj)
  })
  Object.values(variableHighlights).forEach((obj: KeyValuePair) => {
    map.set(obj.name, obj)
  })
  return map
}


export const statusNumbers = () : Map<string, KeyValuePair> => {
  const map: Map<string, KeyValuePair> = new Map<string, KeyValuePair>()
  Object.values(statusVariables).forEach((obj: KeyValuePair) => {
    map.set(obj.name, obj)
  })
  return map
} 


export const specialVars = () : Map<string, KeyValuePair> => {
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
  return map
}               

//  export const localVars = () : Map<string, KeyValuePair> => {
//   const map: Map<string, KeyValuePair> = new Map<string, KeyValuePair>()
//   Object.values(localeVariables).forEach((obj: KeyValuePair) => {
//     map.set(obj.name, obj)
//   })
//   return map
// }

// export const specialVars = (): Map<string, KeyValuePair> => {
//   const map: Map<string, KeyValuePair> = new Map<string, KeyValuePair>()
//   Object.values(specialVariables).forEach((obj: KeyValuePair) => {
//     map.set(obj.name, obj)
//   })
//   return map
// }



export const pipeVars = (): Map<string, KeyValuePair> => {
  const map: Map<string, KeyValuePair> = new Map<string, KeyValuePair>()
  Object.values(pipeCharacters).forEach((obj: KeyValuePair) => {
    map.set(obj.name, obj)
  })
  return map
}

export const Snippets = {
  pipes: pipeVars(),
  specialVars: specialVars(),
  themeVars: highlightVariables(),
  commands: commands()
}
