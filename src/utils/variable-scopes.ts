import Parser, { Tree, SyntaxNode } from 'web-tree-sitter';
import * as NodeTypes from './node-types'

export class VariableDefinitionFlags { 
    public short: string;
    public long: string;

    constructor(short: string, long: string) {
        this.short = short;
        this.long = long;
    }

    isMatch(node: SyntaxNode) {
        if (!NodeTypes.isOption(node)) return false;
        if (NodeTypes.isShortOption(node)) return node.text.split('').includes(this.short);
        if (NodeTypes.isLongOption(node)) return node.text.split('').includes(this.long);
        return false;
    }
}

const variableDefinitionFlags = [
    new VariableDefinitionFlags('g', 'global'),
    new VariableDefinitionFlags('l', 'local'),
    new VariableDefinitionFlags('x', 'export'),
    new VariableDefinitionFlags('f', 'function'),
    new VariableDefinitionFlags('U', 'universal'),
]

export function getVariableCommand() {
    return false;
}