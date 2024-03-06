import {resolve} from 'path';
import Parser from "web-tree-sitter";

const _global: any = global

export async function initializeParser(): Promise<Parser> {
    //const parser = new Parser<typeof Parser>()
    if (_global.fetch) {
        delete _global.fetch
    }

    await Parser.init();
    const parser = new Parser();

    const fishLangPath = resolve(
        //'..',
        __dirname,
        '..',
        'tree-sitter-fish.wasm'
    ).toString()
    // console.log(fishLangPath);

    const lang = await Parser.Language.load(fishLangPath);
    parser.setLanguage(lang);

    return parser;
}