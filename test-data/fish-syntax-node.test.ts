import Parser, { SyntaxNode, Tree } from "web-tree-sitter";
import {getReturnSiblings} from '../src/diagnostics/syntaxError';
import * as NodeTypes from "../src/utils/node-types";
import { getChildNodes, getNamedChildNodes, getNodesTextAsSingleLine, getNodeText, getRange, nodesGen } from "../src/utils/tree-sitter";
import {
    logNodeSingleLine,
    resolveLspDocumentForHelperTestFile,
    TestLogger,
} from "./helpers";
import { buildStatementChildren, ifStatementHasReturn } from '../src/diagnostics/statementHasReturn'
import {collectFunctionNames, collectFunctionsScopes} from '../src/diagnostics/validate';
import {Diagnostic} from 'vscode-languageserver';
//import {FishSyntaxNode} from '../src/utils/fishSyntaxNode';
import {initializeParser} from '../src/parser';
import { findOptionString, findAllOptions, FunctionOpts, VariableOpts } from '../src/utils/options';
import {findParentCommand} from '../src/utils/node-types';
import {execCommandDocs, execCommandType, execCompleteCmdArgs, execCompleteSpace} from '../src/utils/exec';
import {documentationHoverProvider, HoverFromCompletion} from '../src/documentation';
import {createDiagnostic} from '../src/diagnostics/create';
import * as errorCodes from '../src/diagnostics/errorCodes'
import {precedesRange} from '../src/workspace-symbol';


// This file will be used to display what the expected output should be for the
// tree-sitter parses. While the AST defined for fish shell is very helpful, the token
// set required in for an LSP implementation, needs more strongly defined tokens.
// We can see how this is problematic, in the following example:
//
// set -l var1 "hello world"
//  ^  ^   ^        ^-------------- double_quote_string
//  |  |   ------------------------ word
//  |  ---------------------------- word
//  ------------------------------- command: [0,4] - [0, 25]
//                                        name:     word                  [0, 0] [0, 3]
//                                        argument: word                  [0, 4] [0, 6]
//                                        argument: word                  [0, 7] [0, 11]
//                                        argument: double_quote_string   [0, 12] [0, 25]
//
// Some data we want to be prepared to collect from the AST shown above, can be shown in the following example:
//
//  1. get the variable name.
//       - check if the name command has a parent which is a command
//       - check if the command has a firstNamedChild.text that is 'set'
//       - check if the first non-option ('-l' is the option) is the same node
//         that we are currently checking.
//
// 2. get the option(s) seen.
//      - here similiarly we check that it is a command node,
//      - then we can also check that the node.text starts with '-' char, and is not an
//        actual '--' which would escape the command. (Example: string match -ra '\-.*' -- '-l')
//
// In this example, the checks are done through a series of very low computation time
// lookups. All implementations, should do their best to use O(1) lookups that fail
// fast, before checking the children nodes.
//
// Feel free to improve this file, as a reference for other developers.

let SHOULD_LOG = false; // enable for verbose

let parser: Parser;
const jestConsole = console;
const logger = new TestLogger(jestConsole);




const loggingON = () => { SHOULD_LOG = true; }



// BEGIN TESTS
describe("FISH web-tree-sitter SUITE", () => {
    beforeEach(async () => {
        parser = await initializeParser();
        global.console = require("console");
    });
    afterEach(() => {
        global.console = jestConsole;
        SHOULD_LOG = false;
    });

    it("test simple variable definitions", async () => {
        const test_variable_definitions = resolveLspDocumentForHelperTestFile("fish_files/simple/set_var.fish");
        const root = parser.parse(test_variable_definitions.getText()).rootNode;

        const defs    : SyntaxNode[] = [];
        const defNames: SyntaxNode[] = [];
        const vars    : SyntaxNode[]= [];
        getChildNodes(root).forEach((node, idx) => {
            if (!node.isNamed()) return;
            if (NodeTypes.isCommand(node)) defs.push(node)
            if (NodeTypes.isCommandName(node))defNames.push(node)
            if (NodeTypes.isVariableDefinition(node)) vars.push(node)
            return node
        });

        expect(defs.length === 1).toBeTruthy();
        expect(defNames.length === 1).toBeTruthy();
        expect(vars.length === 1).toBeTruthy();

        if (SHOULD_LOG) [...defs, ...defNames, ...vars].forEach((node) => logger.logNode(node))
    });


    it("test defined function", async () => {
        const test_doc = resolveLspDocumentForHelperTestFile("fish_files/simple/simple_function.fish");
        const root = parser.parse(test_doc.getText()).rootNode;

        const funcs    : SyntaxNode[] = [];
        const funcNames : SyntaxNode[] = [];

        getChildNodes(root).forEach((node, idx) => {
            if (!node.isNamed()) return;
            if (NodeTypes.isFunctionDefinition(node)) funcs.push(node)
            if (NodeTypes.isFunctionDefinitionName(node)) funcNames.push(node)
            return node
        })

        expect(funcs.length === 1).toBeTruthy();
        expect(funcNames.length === 1).toBeTruthy();
        if (SHOULD_LOG) [...funcs, ...funcNames].forEach((node) => logger.logNode(node, 'funcs vs funcName'))
    })

    it("test defined function", async () => {
        const test_doc = resolveLspDocumentForHelperTestFile("fish_files/simple/function_variable_def.fish");
        const root = parser.parse(test_doc.getText()).rootNode;

        const funcNames : SyntaxNode[] = [];
        const vars      : SyntaxNode[] = [];

        getChildNodes(root).forEach((node, idx) => {
            if (!node.isNamed()) return;
            if (NodeTypes.isFunctionDefinitionName(node)) funcNames.push(node)
            if (NodeTypes.isVariableDefinition(node)) vars.push(node)
            return node
        })

        expect(funcNames.length === 1).toBeTruthy();
        expect(vars.length === 2).toBeTruthy();
        if (SHOULD_LOG) [...vars].forEach((node) => logger.logNode(node, 'function variable definitions'))
    })   

    it("test all variable def types ", async () => {
        const test_doc = resolveLspDocumentForHelperTestFile("fish_files/simple/all_variable_def_types.fish");
        const parser = await initializeParser();
        const root = parser.parse(test_doc.getText()).rootNode;

        const vars      : SyntaxNode[] = [];

        getChildNodes(root).forEach((node, idx) => {
            if (!node.isNamed()) return;
            if (NodeTypes.isVariableDefinition(node)) vars.push(node)
            return node
        })

        expect(vars.length).toEqual(7);
        if (SHOULD_LOG) [...vars].forEach((node) => logger.logNode(node, 'function variable definitions'))
    })

    it("test is func_a", async () => {
        loggingON();
        const parser = await initializeParser();
        const test_doc = resolveLspDocumentForHelperTestFile("fish_files/simple/func_a.fish", true);
        const root = parser.parse(test_doc.getText()).rootNode;
        const opts = getChildNodes(root)
            .filter(node => NodeTypes.isDefinition(node))
            .map(node => {
                return node.text + ' ' + findOptionString(node)
            })
        console.log(opts);
    })
    it("test is function_variable_def", async () => {
        loggingON();
        const parser = await initializeParser();
        const test_doc = resolveLspDocumentForHelperTestFile("fish_files/simple/function_variable_def.fish", true);
        const root = parser.parse(test_doc.getText()).rootNode;
        const opts = getChildNodes(root)
            .filter(node => NodeTypes.isDefinition(node))
            .map(node => {
                return node.text + ' ' + findOptionString(node)
            })
        console.log(opts);
    })
})
