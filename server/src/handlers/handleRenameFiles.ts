import { relative, dirname, basename } from 'path'
import { FileRename, RenameFilesParams, TextEdit } from 'vscode-languageserver/node'
import { SyntaxNode, Tree } from 'web-tree-sitter'
import { Context, TreesByUri } from '../interfaces'
import { getAwkFilesInDir, isDir } from '../io'
import { getRange, isAwkExtension, isInclude } from '../utils'

type ParentURI = string

function getIncludes(tree: Tree): SyntaxNode[] {
  return tree.rootNode.namedChildren.filter(isInclude)
}

function getIncludeEdits(
  changes: Map<ParentURI, FileRename[]>,
  trees: TreesByUri,
): Record<ParentURI, TextEdit[]> {
  const result: Record<ParentURI, TextEdit[]> = {}

  for (const [parentUri, renames] of changes) {
    if (!result[parentUri]) result[parentUri] = []

    const parentDirUri = dirname(parentUri)

    for (const r of renames) {
      const oldRelPath = relative(parentDirUri, r.oldUri)
      const newRelPath = relative(parentDirUri, r.newUri)
      const oldIncludeNode = getIncludes(trees[parentUri]).find((n) => {
        const includeText = n.lastNamedChild!.text.replace(/"/g, '')

        if (isAwkExtension(includeText)) {
          return includeText === oldRelPath
        }

        return `${includeText}.awk` === oldRelPath
      })

      if (!oldIncludeNode) continue

      const range = getRange(oldIncludeNode)
      const newIncludeText = newRelPath.endsWith('.awk')
        ? newRelPath.slice(0, -4)
        : newRelPath

      result[parentUri].push(TextEdit.replace(range, `@include "${newIncludeText}"`))
    }
  }

  return result
}

/**
 * Adapt folder renames to file renames
 */
export function adaptFolderRenames(files: FileRename[]): FileRename[] {
  return (
    files
      .flatMap(({ oldUri, newUri }) => {
        // newUri because handling DidRename
        if (isDir(newUri)) {
          return getAwkFilesInDir(newUri).map((fileUrl) => {
            const separator = oldUri.endsWith('/') ? '' : '/'
            return {
              oldUri: oldUri + separator + basename(fileUrl.toString()),
              newUri: fileUrl.toString(),
            }
          })
        }

        return { oldUri, newUri }
      })
      // This is a workaround
      // https://github.com/microsoft/vscode-languageserver-node/issues/734
      .filter(({ newUri }) => isAwkExtension(newUri))
  )
}

export function getRenameFilesHandler(context: Context) {
  const { trees, symbols, namespaces, dependencies } = context

  return function handleRenameFiles(params: RenameFilesParams): void {
    const fileRenames = adaptFolderRenames(params.files)

    // Multiple file renames might result in multiple changes to the same parent document
    // This allows to aggregate such changes and not change the same file multiple times
    const changesInParents: Map<ParentURI, FileRename[]> = new Map()

    for (const file of fileRenames) {
      trees[file.newUri] = trees[file.oldUri]
      symbols[file.newUri] = symbols[file.oldUri]
      namespaces[file.newUri] = namespaces[file.oldUri]

      delete trees[file.oldUri]
      delete symbols[file.oldUri]
      delete namespaces[file.oldUri]

      const depNode = dependencies.get(file.oldUri)

      for (const childUri of depNode.childrenUris) {
        dependencies.get(childUri).parentUris.delete(file.oldUri)
        dependencies.get(childUri).parentUris.add(file.newUri)
      }

      for (const parentUri of depNode.parentUris) {
        dependencies.get(parentUri).childrenUris.delete(file.oldUri)
        dependencies.get(parentUri).childrenUris.add(file.newUri)

        if (!changesInParents.has(parentUri)) changesInParents.set(parentUri, [])

        changesInParents.get(parentUri)!.push(file)
      }

      dependencies.set(file.newUri, depNode)
      dependencies.delete(file.oldUri)
    }

    context.connection.workspace.applyEdit({
      changes: getIncludeEdits(changesInParents, trees),
    })
  }
}
