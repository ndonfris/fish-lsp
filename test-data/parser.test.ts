import Parser from "web-tree-sitter";
import {initializeParser} from '../src/parser'
//import fish from 'tree-sitter-fish'
import {setLogger} from './helpers'

setLogger()

describe('parser test-suite', () => {
    it('should be able to load the parser', async () => {
        const fish = require('tree-sitter-fish');
        const parser = await initializeParser()
        const t = parser.parse('set -gx v "hello world"').rootNode
        expect(parser).toBeDefined()
    })
})