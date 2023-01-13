import {SyntaxNode} from 'web-tree-sitter';
import {execFindDependency} from './utils/exec';






// removed
export class Dependencies {

    public globalDeps: Map<string, string>;

    constructor() {
        this.globalDeps =  new Map<string, string>();
    }

    async newCommands(commands: SyntaxNode[]) {
        const result = [];
        for (const cmd of commands) {
            const text = cmd?.firstChild?.text.trim() || ''
            if (!text) continue;
            if (this.globalDeps.has(text)) {
                result.push(this.globalDeps.get(text))
                continue
            } else{
                const uri = await execFindDependency(text)
                this.globalDeps.set(text, uri)
            }
        }
        return result;
    }
}










