import Parser from "web-tree-sitter";

const _global: any = global

export async function initializeParser(): Promise<Parser> {
    //const parser = new Parser<typeof Parser>()
    if (_global.fetch) {
        delete _global.fetch
    }

    await Parser.init();
    const parser = new Parser();

    const lang = await Parser.Language.load(`${__dirname}/tree-sitter-fish.wasm`);

    parser.setLanguage(lang);

    return parser;
}


