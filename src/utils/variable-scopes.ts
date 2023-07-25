import Parser, { Tree, SyntaxNode } from 'web-tree-sitter';
import * as NodeTypes from './node-types'
import { gatherSiblingsTillEol } from './node-types';
import { ancestorMatch, firstAncestorMatch } from './tree-sitter';

export class VariableDefinitionFlag { 
    public short: string;
    public long: string;

    constructor(short: string, long: string) {
        this.short = short;
        this.long = long;
    }

    isMatch(node: SyntaxNode) {
        if (!NodeTypes.isOption(node)) return false;
        if (NodeTypes.isShortOption(node)) return node.text.slice(1).split('').includes(this.short);
        if (NodeTypes.isLongOption(node)) return node.text.slice(2) === this.long;
        return false;
    }

    get kind() {
        return this.long
    }
}

const variableDefinitionFlags = [
    new VariableDefinitionFlag('g', 'global'),
    new VariableDefinitionFlag('l', 'local'),
    //new VariableDefinitionFlag('x', 'export'),
    new VariableDefinitionFlag('f', 'function'),
    new VariableDefinitionFlag('U', 'universal'),
]

function getMatchingFlags(nodes: SyntaxNode[]) {
    for (const node of nodes) {
        const match = variableDefinitionFlags.find(flag => flag.isMatch(node))
        if (match) {
            return match;
        }
    }
    return new VariableDefinitionFlag('f', 'function');
}

export function expandEntireVariableLine(node: SyntaxNode): SyntaxNode[] {
    const results: SyntaxNode[] = [node]

    let current = node.previousSibling
    while (current !== null) {
        if (!current || NodeTypes.isNewline(current)) break;
        results.unshift(current)
        current = current.previousSibling
    }

    current = node.nextSibling
    while (current !== null) {
        if (!current || NodeTypes.isNewline(current)) break;
        results.push(current)
        current = current.nextSibling
    }

    return results;
}


function findScopeFromFlag(node: SyntaxNode, flag: VariableDefinitionFlag) {
    switch (flag.kind) {
        case 'global':
        case 'universal':
            return firstAncestorMatch(node, NodeTypes.isProgram)
        case 'local':
            return firstAncestorMatch(node, NodeTypes.isScope)
        case 'function':
            return  firstAncestorMatch(node, NodeTypes.isFunctionDefinition)
        case 'for_scope':
            return firstAncestorMatch(node, NodeTypes.isFunctionDefinition) || firstAncestorMatch(node, NodeTypes.isProgram)
        default:
            return firstAncestorMatch(node, NodeTypes.isScope)
    }
}

export function getVariableScope(node: SyntaxNode) {

    const definitionNodes: SyntaxNode[] = expandEntireVariableLine(node)
    const keywordNode = definitionNodes[0];

    let matchingFlag = null;

    switch (keywordNode.text) {
        case 'for':
            matchingFlag = new VariableDefinitionFlag('', 'for_scope');
            break;
        case 'set':
        case 'read':
        case 'function':
        default: 
            matchingFlag = getMatchingFlags(definitionNodes)
            break;
    }

    const scope = findScopeFromFlag(node, matchingFlag)
    return scope;
}