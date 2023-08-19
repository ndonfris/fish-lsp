import { assert } from "chai";
import { setLogger } from "./helpers";
import { getFlagCommand, getFlagDocumentationString } from "../src/utils/flag-documentation";


setLogger()

describe("flag-documentation test suite", () => {
 
    it("set --local", async () => {
        const testStr =  'set --local'
        const res = await getFlagDocumentationString(testStr)
        const name = await getFlagCommand(testStr)
        console.log('name', `'${name}'`);
        console.log('res', res);
    })

    it("set -lx", async () => {
        const testStr =  'set -lx'
        const res = await getFlagDocumentationString(testStr)
        const name = await getFlagCommand(testStr)
        console.log('name', `'${name}'`);
        console.log('res', res);
    })

    it("if set -lx", async () => {
        const testStr =  'if set -lx'
        const res = await getFlagDocumentationString(testStr)
        const name = await getFlagCommand(testStr)
        console.log('name', `'${name}'`);
        console.log('res', res);
    })

    it('find -name ".git"', async () => {
        const testStr =  'find -name ".git"'
        const res = await getFlagDocumentationString(testStr)
        const name = await getFlagCommand(testStr)
        console.log('name', `'${name}'`);
        console.log('res', res);
    })

    it('string match -raq "(.*) $argv', async () => {
        const testStr =  'string match -raq "(.*) $argv'
        const res = await getFlagDocumentationString(testStr)
        const name = await getFlagCommand(testStr)
        console.log('name', `'${name}'`);
        console.log('res', res);
    })
})