import Parser, { Tree, SyntaxNode } from 'web-tree-sitter';
import { initializeParser } from '../src/parser';
import { getChildNodes } from '../src/utils/tree-sitter';
import * as NodeTypes from '../src/utils/node-types'
import { assert } from 'chai';

function parseStringForNodeType(str: string, predicate: (n:SyntaxNode) => boolean) {
    const tree = parser.parse(str);
    const root = tree.rootNode;
    return getChildNodes(root).filter(predicate);
}

function logNodes(nodes: SyntaxNode[]) {
    nodes.forEach(n => console.log(n.text))
}

let parser: Parser;
const jestConsole = console;

beforeEach(async () => {
    parser = await initializeParser();
    global.console = require("console");
})

afterEach(() => {
    global.console = jestConsole;
    if (parser) parser.delete();
});


describe("node-types tests", () => {
    it('isCommand', () => {
        const commands = parseStringForNodeType('echo "hello world"', NodeTypes.isCommand);
        assert.equal(commands[0].text, 'echo "hello world"')
    })


    it('isCommandName', () => {
        const commandsName = parseStringForNodeType('echo "hello world"', NodeTypes.isCommandName);
        assert.equal(commandsName[0].text, 'echo')
    })

    it('isComment', () => {
        const comments = parseStringForNodeType('# this is a comment', NodeTypes.isComment);
        assert.equal(comments[0].text, '# this is a comment')

    })

    it('isShebang', () => {
        const testString = [
            "#!/usr/bin/env fish",
            "# this is a comment",
            "#!/usr/bin/fish",
        ].join("\n");
        const shebang = parseStringForNodeType(testString, NodeTypes.isShebang);
        const comments = parseStringForNodeType(testString, NodeTypes.isComment);
        assert.equal(shebang.length, 1)
        assert.equal(comments.length, 2)
    })

    it('isProgram', () => {
        const input = 'echo "hello world"';
        const root = parser.parse(input).rootNode!
        const program = parseStringForNodeType(input, NodeTypes.isProgram);
        assert.equal(program[0].text, root.text)
    })

    it('isStatement', () => {
        const input = [ 
            'for i in (seq 1 10); echo $i; end;',
            'while read -S line; echo $line;end;',
            'if test -f $file; echo "file exists"; else; echo "file does not exist";end;',
            'switch $var; case 1; echo "one"; case 2; echo "two"; case 3; echo "three"; end;',
            'begin; echo "hello world"; end;',
        ].join('\n');
        // checks for 5 different kinds of statements ->
        //        for_statement, while_statement, if_statement, switch_statement, begin_statement
        const statement = parseStringForNodeType(input, NodeTypes.isStatement);
        assert.equal(statement.length, 5)
    })

    it('isEnd', () => {
        const input = [ 
            'for i in (seq 1 10); echo $i; end;',
            'while read -S line; echo $line;end;',
            'if test -f $file; echo "file exists"; else; echo "file does not exist";end;',
            'switch $var; case 1; echo "one"; case 2; echo "two"; case 3; echo "three"; end;',
            'begin; echo "hello world"; end;',
        ].join('\n');
        const ends = parseStringForNodeType(input, NodeTypes.isEnd);
        assert.equal(ends.length, 5)
    })

    it('isString', ()  => {
        const input = [
            `echo "hello world"`,
            `echo 'hello world'`,
        ].join('\n');
        const strings = parseStringForNodeType(input, NodeTypes.isString);
        assert.equal(strings.length, 2)
    })

    it('isReturn', () => {
        const input = [
            'function false',
            '    return 1',
            'end'
        ].join('\n')
        const returns = parseStringForNodeType(input, NodeTypes.isReturn);
        //logNodes(returns)
        assert.equal(returns.length, 1)
    })

    it('isFunctionDefinition', () => {
        const input = [
            `function foo; echo "hello world"; end;`,
            `function foo_2`,
            `    function foo_2_inner`,
            `        echo "hello world"`,
            `    end`,
            `    foo_2_inner`,
            `end`,
        ].join('\n')
        const functionDefinitions = parseStringForNodeType(input, NodeTypes.isFunctionDefinition);
        assert.equal(functionDefinitions.length, 3)
    })

    it('isFunctionDefinitionName', () => {
        const input = [
            `function foo; echo "hello world"; end;`,
            `function foo_2`,
            `    function foo_2_inner`,
            `        echo "hello world"`,
            `    end`,
            `    foo_2_inner`,
            `end`,
        ].join('\n')
        const functionDefinitionNames = parseStringForNodeType(input, NodeTypes.isFunctionDefinitionName);
        assert.equal(functionDefinitionNames.length, 3)
        assert.deepEqual(functionDefinitionNames.map(n => n.text), ['foo', 'foo_2', 'foo_2_inner'])
    })

})


