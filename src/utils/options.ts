import Parser, { SyntaxNode, Tree } from "web-tree-sitter";
import { isDefinition, isVariableDefinition, isFunctionDefinitionName } from "./node-types";

const isLongOption = (text: string): boolean => text.startsWith('--');
const isShortOption = (text: string): boolean => text.startsWith('-') && !isLongOption(text);
const isOption = (text: string): boolean => isShortOption(text) || isLongOption(text);

export class FishCommandOption {
    constructor(
        public description: string,
        public shortFlags: string,
        public longFlags: string,
        public values: 'none' | 'single' | 'multi' = 'none',
        public partialShortFlags: boolean = true
    ) {}
    is(text: string): boolean {
        if (isShortOption(text)) {
            const newText = text.slice(1);
            return this.partialShortFlags 
                ? newText.split('').some((flag) => this.shortFlags ===flag)
                : this.shortFlags === newText;
        } else if (isLongOption(text)) {
            return this.longFlags === text.slice(2);
        }
        return false;
    }
}

const FunctionOptions = [
    new FishCommandOption('description',                              'd', 'description',        'single',  false),
    new FishCommandOption('list of arguments',                        'a', 'argument-names',     'multi',   false),
    new FishCommandOption("variables inherited from the caller scope",'V', 'inherit-variable',   'multi',   false),
    new FishCommandOption('no scope shadowing',                       'S', 'no-scope-shadowing', 'none',    false),
]

const VariableOptions = [
    new FishCommandOption('locally scoped',    'l',    'local',  'none'),
    new FishCommandOption('exported',          'x',   'export',  'none'),
    new FishCommandOption('globally scoped',   'g',   'global',  'none'),
    new FishCommandOption('universally scoped','U','universal',  'none'),
]


export function findOptionString(node: SyntaxNode) {
    if (!isDefinition(node)) return null;
    if (isVariableDefinition(node)) return ""
    if (isFunctionDefinitionName(node)) return ""
    return null;
}
