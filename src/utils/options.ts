import Parser, { SyntaxNode, Tree } from "web-tree-sitter";

const isLongOption = (text: string): boolean => text.startsWith('--');
const isShortOption = (text: string): boolean => text.startsWith('-') && !isLongOption(text);
const isOption = (text: string): boolean => isShortOption(text) || isLongOption(text);

export class FishCommandOption {

    constructor(
        public name: string,
        public description: string,
        public shortFlags: string[],
        public longFlags: string[],
        public values: 'none' | 'single' | 'multi' = 'none',
        public partialShortFlags: boolean = true
    ) {}

    is(text: string): boolean {
        if (isShortOption(text)) {
            const newText = text.slice(1);
            return this.partialShortFlags 
                ? newText.split('').some((flag) => this.shortFlags.includes(flag))
                : this.shortFlags.includes(newText);
        } else if (isLongOption(text)) {
            return this.longFlags.includes(text.slice(2));
        }
        return false;
    }

}


const FunctionDescription = new FishCommandOption(
    'description',
    'A description of the function',
    ['d'],
    ['description'],
    'single',
    false
);

const FunctionArgumentsNames = new FishCommandOption(
    'arguments',
    'A list of arguments for the function',
    ['a'],
    ['argument-names'],
    'multi',
    false,
);

const FunctionInheritVariables = new FishCommandOption(
    'inherit',
    'inherit variables from the caller scope',
    ['i'],
    ['inherit-variable'],
    'multi',
    false
);


    







