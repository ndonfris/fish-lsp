import { getFunctionSignature, getQueriesList, isNodeWithinRange } from '../src/utils'
import { initializeParser } from '../src/parser'
import * as Parser from 'web-tree-sitter'
import { getRange } from './helpers'

function normalizeSpace(str: string): string {
  return str
    .replace(/ {2,}/g, ' ')
    .replace(/([\[(]) /g, (_, p1) => p1)
    .replace(/ ([\])])/g, (_, p1) => p1)
}

describe('getQueriesList function', () => {
  it('Should split multiple queries from a string into list', () => {
    const result = getQueriesList(`
      (func_def name: (identifier) @function)
      (func_call name: (identifier) @function)
    `)

    expect(result).toEqual([
      '(func_def name: (identifier) @function)',
      '(func_call name: (identifier) @function)',
    ])
  })

  it('Should not add comments to resulting list', () => {
    const result = getQueriesList(`
      (func_def name: (identifier) ; Here goes comment
      @function)
    `)

    expect(result.map(normalizeSpace)).toEqual([
      '(func_def name: (identifier) @function)',
    ])
  })

  it('Should respect open brackets', () => {
    const result = getQueriesList(`
      [
        "function"
        "print"
      ] @keyword
    `)

    expect(result.map(normalizeSpace)).toEqual(['["function" "print"] @keyword'])
  })

  it('Should prioritize quotes over comments, parens, etc.', () => {
    const result = getQueriesList(`
      [
        ";"
        "("
        "["
      ] @punctuation
    `)

    expect(result.map(normalizeSpace)).toEqual(['[";" "(" "["] @punctuation'])
  })
})

describe('getFunctionSignature function', () => {
  let parser: Parser

  beforeAll(async () => {
    parser = await initializeParser()
  })

  it('Should work for params in one line', () => {
    const tree = parser.parse('function f(a, b) {}')
    const functionDefinitionNode = tree.rootNode.descendantsOfType('func_def')[0]

    expect(getFunctionSignature(functionDefinitionNode)).toEqual('f(a, b)')
  })

  it('Should work for params in multiple lines', () => {
    const tree = parser.parse(`
    function f(
      a,
      b
    ) {}
    `)
    const functionDefinitionNode = tree.rootNode.descendantsOfType('func_def')[0]

    expect(getFunctionSignature(functionDefinitionNode)).toEqual('f(a, b)')
  })

  it('Should handle comments in params', () => {
    const tree = parser.parse(`
    function f(a,
      # comment
      b
    ) {}
    `)
    const functionDefinitionNode = tree.rootNode.descendantsOfType('func_def')[0]

    expect(getFunctionSignature(functionDefinitionNode)).toEqual('f(a, b)')
  })
})

describe('isNodeWithinRange function', () => {
  it('Should handle a node inside range rows', () => {
    const node = {
      startPosition: {
        row: 1,
        column: 0,
      },
      endPosition: {
        row: 2,
        column: 0,
      },
    } as Parser.SyntaxNode

    const range = getRange(0, 0, 3, 0)

    expect(isNodeWithinRange(node, range)).toBeTruthy()
  })

  it('Should handle a node on the same line as range start', () => {
    const node = {
      startPosition: {
        row: 0,
        column: 1,
      },
      endPosition: {
        row: 0,
        column: 2,
      },
    } as Parser.SyntaxNode

    const range = getRange(0, 0, 3, 0)

    expect(isNodeWithinRange(node, range)).toBeTruthy()
  })

  it('Should handle a node on the same line as range end', () => {
    const node = {
      startPosition: {
        row: 3,
        column: 0,
      },
      endPosition: {
        row: 3,
        column: 2,
      },
    } as Parser.SyntaxNode

    const range = getRange(0, 0, 3, 2)

    expect(isNodeWithinRange(node, range)).toBeTruthy()
  })
})
