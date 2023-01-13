import { DocumentUri, InlayHint, InlayHintKind, Range, } from 'vscode-languageserver';
import { LspDocuments } from '../document';
import { ConfigManager } from '../configManager';
import { uriToPath } from '../utils/translation';
import { Analyzer } from '../analyze';
import {getRange, pointToPosition} from '../utils/tree-sitter';
import * as Locations from '../utils/locations'
import {isCommandName} from '../utils/node-types';
import {execInlayHintType} from '../utils/exec';


export class FishShellInlayHintsProvider {

    public static async provideInlayHints(
        uri: DocumentUri,
        range: Range,
        documents: LspDocuments,
        analyzer: Analyzer,
        configurationMangaer: ConfigManager,
    )   : Promise<InlayHint[]> {
        const hints: InlayHint[] = [];
        const file = uriToPath(uri);
        if (!file) {
            return hints;
        }
        const document = documents.get(file);
        if (!document) {
            return hints;
        }
        const start = document.offsetAt(range.start)
        const length = document.offsetAt(range.end) - start;
        const nodes = analyzer.getNodes(document).filter(node => isCommandName(node))
        const config = configurationMangaer.getInlayHintsEnabled();
        for (const node of nodes) {
            let text = ''
            text = await execInlayHintType(`type -t ${node.text} | cut -d ' ' -f1 2>/dev/null`)
            const hint = InlayHint.create({line: node.startPosition.row, character: node.startPosition.column}, text, InlayHintKind.Type)
            hint.paddingLeft = true
            hints.push(hint)
        }
        return hints;

    }

}
