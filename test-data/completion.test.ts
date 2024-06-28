//import { generateCompletionList } from '../src/completion';
import Parser, { SyntaxNode } from 'web-tree-sitter';
import { initializeParser } from '../src/parser';
import { setLogger } from './helpers';
import { getChildNodes, getCommandArgumentValue, matchesArgument } from '../src/utils/tree-sitter';
import * as CACHE from '../src/utils/completion/startup-cache';
import { CompletionPager, initializeCompletionPager } from '../src/utils/completion/pager';
import { Logger } from '../src/logger';

let parser: Parser;
let pager: CompletionPager;
let items: CACHE.CompletionItemMap;

setLogger(
  async () => {
    pager = await initializeCompletionPager(new Logger(), items);
  },
  async () => {
  },
);

describe('complete simple tests', () => {
  it('value', async () => {
    expect(true).toBe(true);
  });

  it('get command argument value', async () => {
    const inputList: string[] = [
      'string split --max 1 = \'a=b\'',
    ];
    const log = (found?: SyntaxNode | null) => {
      console.log({ found: found?.text || '', str: found?.toString() || '' });
    };
    const parser = await initializeParser();
    for (const input of inputList) {
      const { rootNode } = parser.parse(input);
      const node = rootNode.descendantForPosition({ row: 0, column: 0 });

      log(node.parent!);
      const found = getCommandArgumentValue(node, '--max');
      log(found);
      const found2 = getChildNodes(rootNode).find(c => matchesArgument(c, '--max'));
      //log({found: found?.text || '', str: found?.toString() || ''});
      log(found2);
    }
    expect(true).toBe(true);
  });
});

//export async function createCompletionList(input: string) {
//    const result: FishCompletionItem[] = [];
//    const {word, command, wordNode, commandNode, index} = completions.getNodeContext(input);
//    if (!command) {
//        return items.allCompletionsWithoutCommand().filter((item) => item.label.startsWith(input))
//    }
//    switch (command) {
//        //case "functions":
//        //    return index === 1 ? items.allOfKinds("function", 'alias') : result;
//        //case "command":
//        //    return index === 1 ?items.allOfKinds("command") : result;
//        //case 'builtin':
//        //    return index === 1 ? items.allOfKinds("builtin") : result;
//        case "end":
//            return items.allOfKinds("pipe");
//        case "printf":
//            return index === 1 ? items.allOfKinds("format_str", "esc_chars") : items.allOfKinds("variable");
//        case "set":
//            return items.allOfKinds("variable");
//        //case 'function':
//        //    //if (isOption(lastNode) && ['-e', '--on-event'].includes(lastNode.text)) result.push(CompletionItemsArrayTypes.FUNCTIONS);
//        //    //if (isOption(lastNode) && ['-v', '--on-variable'].includes(lastNode.text)) result.push(CompletionItemsArrayTypes.VARIABLES);
//        //    //if (isOption(lastNode) && ['-V', '--inherit-variable'].includes(lastNode.text)) result.push(CompletionItemsArrayTypes.VARIABLES);
//        //    //result.push(CompletionItemsArrayTypes.AUTOLOAD_FILENAME);
//        //    break
//        case "return":
//            return items.allOfKinds("status", "variable");
//        default:
//            return items.allOfKinds("pipe");
//    }
//    return result
//
//}

export const completionStrings : string[] = [
  'echo ',
  'ls',
  'ls ',
  'ls -',
  'if',
  'if ',
  'if t',
  ';',
  'if [',
  'if [ ',
  'if test',
  'if (a',
  'printf "',
  '',
  'for',
  'for ',
  'for i',
  'for i ',
  'for i in',
  'while',
  'while (',
  'while ()',
  'echo "hi" > ',
  'function',
  'else if',
  'else',
  'case',
  'case ',
  'case \'*',
  'end',
  'ls |',
  'not',
  'and',
  'and test',
  'and test ',
  'or ',
  'if test -f file.txt; and test -f file2.txt; or ',
  'ls | read',
  'ls | read ',
  'ls | read -',
  'ls | read -L',
  'ls | read -L ',
  'ls | read -L -l',
  'ls | read -L -l v',
  'continue',
  'continue ',
];
