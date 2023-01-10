import {FoldingRange, FoldingRangeParams, FoldingRangeKind } from 'vscode-languageserver';
import {SyntaxNode} from 'web-tree-sitter';
import {isComment, isFunctionDefinition} from './utils/node-types';
import {toFoldingRange} from './utils/translation';
import {getChildNodes} from './utils/tree-sitter';




export class FoldsMap {
    private folds: {[uri: string]: FoldingRange[]} = {}

    setUri(uri: string, rootNode: SyntaxNode) {
        this.folds[uri] = []
        //this.folds[uri] = getAllFolds(rootNode);
    }



    public getFoldingRanges(params: FoldingRangeParams): FoldingRange[] {

        return this.folds[params.textDocument.uri]
    }



}


//export function getAllFolds(rootNode: SyntaxNode): FoldingRange[] {
    //const folds: FoldingRange[] = [];
    //for (const node of getChildNodes(rootNode).filter(n => isComment(n) || isFunctionDefinition(n))) {
        //const fold = toFoldingRange(node);
        //if (fold) folds.push(fold);
    //}
    //return folds;
//}
