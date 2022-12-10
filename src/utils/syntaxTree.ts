import Parser, {SyntaxNode, Tree} from 'web-tree-sitter';
import { getChildNodes, getRange } from './tree-sitter'
import { isCommand, findSetDefinedVariable, isFunctionDefinition, isVariable, findFunctionScope, hasParentFunction, isStatement, isVariableDefintion,  } from './node-types'
import { Location } from 'vscode-languageserver';

// @TODO: NOTHING EXPORTED 

type FishLspType = 'variable' | 'variable_definition' | 'function_definition' | 'command' | 'statement'

interface FishLspToken {
    node: SyntaxNode;
    location: Location;
    text: string; 
    fishLspType: FishLspType;
}


/** 
 * SyntaxTree is necessary because the parse will retrieve node at the given position
 * with type of word, this instead stores from top down, so we get node types of:
 * command, function, variable, variable_definition, etc.
 * Think of better data-structure though and provide method to get completionItems 
 */
class SyntaxTree {
    public rootNode: SyntaxNode;
    public tree: Tree;
    public nodes: SyntaxNode[] = [];
    public functions: SyntaxNode[] = [];
    public commands: SyntaxNode[] = [];
    public variable_definitions: SyntaxNode[] = [];
    public variables: SyntaxNode[] = [];
    public statements: SyntaxNode[] = [];
    public locations: Location[] = [] ;

    constructor(tree: Parser.Tree) {
        this.tree = tree;
        this.rootNode = this.tree.rootNode;
        this.clearAll();
        this.ensureAnalyzed();
    }

    public ensureAnalyzed() {
        this.clearAll()
        const newNodes = getChildNodes(this.rootNode)
        for (const newNode of getChildNodes(this.rootNode)) {
            if (isCommand(newNode)) {
                this.commands.push(newNode)
            }
            if (isFunctionDefinition(newNode)) {
                this.functions.push(newNode)
            }
            if (isVariable(newNode)) {
                this.variables.push(newNode)
            }
            if (isVariableDefintion(newNode)) {
                this.variable_definitions.push(newNode)
            }
            if (isStatement(newNode)) {
                this.statements.push(newNode)
            }
        }
        return newNodes;
    }

    public clearAll() {
        this.functions = [];
        this.variables = [];
        this.variable_definitions = [];
        this.commands = [];
    }

    public getUniqueCommands(): string[] {
        return [
            ...new Set(
                this.commands
                    .map((node: SyntaxNode) => node?.firstChild?.text.trim() || "")
                    .filter((nodeStr) => nodeStr != "")
            ),
        ];
    }

    public getNodeRanges() {
        return this.nodes.map((node) => getRange(node));
    }

    public hasRoot(): boolean {
        return this.rootNode != null;
    }

    public getNodes() {
        this.ensureAnalyzed();
        return this.nodes;
    }

    public getLocalFunctionDefinition(searchNode: SyntaxNode) {
        for (const func of getChildNodes(this.rootNode)) {
            if (isFunctionDefinition(func) && func.children[1]?.text == searchNode.text) {
                return func
            }
        }
        return undefined

    }

    // techincally this is nearest variable refrence that is a definition
    public getNearestVariableDefinition(searchNode: SyntaxNode) {
        if (!isVariable(searchNode)) return undefined
        const varaibleDefinitions: SyntaxNode[] = [];
        const functionScope = findFunctionScope(searchNode) 
        const scopedVariableLocations: SyntaxNode[] = [
            ...getChildNodes(functionScope),
            ...this.getOutmostScopedNodes()
        ]
        for (const node of scopedVariableLocations) {
            if (isVariableDefintion(node) && firstNodeBeforeSecondNodeComaprision(node, searchNode)) {
                const v = findSetDefinedVariable(node);
                if (!v || !v?.parent) continue;
                varaibleDefinitions.push(v);
            }
        }
        const result = varaibleDefinitions.pop()
        if (!result || !result.parent) return undefined
        return result.parent
    }

    // global nodes are nodes that are not defined in a function
    // (i.e. stuff in config.fish)
    public getOutmostScopedNodes() {
        const allNodes = [ 
            ...getChildNodes(this.rootNode)
                .filter(n => !hasParentFunction(n))
        ].filter(n => n.type != 'program')
        return allNodes
    }
}



function firstNodeBeforeSecondNodeComaprision(
    firstNode: SyntaxNode,
    secondNode: SyntaxNode
) {
    return (
        firstNode.startPosition.row < secondNode.startPosition.row &&
        firstNode.startPosition.column < secondNode.startPosition.column &&
        firstNode.text == secondNode.text
    );
}
