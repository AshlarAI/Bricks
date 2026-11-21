// The changed files as folders you can open, as shadcn's File Tree: a folder is a
// Collapsible whose trigger is a ghost Button, a file is whatever `file` renders.
// Folders start open. Folders use Lucide's outline icons; files keep Bricks's language icons.
import { Fragment, useState, type ReactNode } from 'react'
import { ChevronRightIcon, FolderIcon, FolderOpenIcon } from 'lucide-react'
import { Button } from '$lib/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '$lib/components/ui/collapsible'
import type { TreeNode } from './tree'

export interface ChangeTreeProps<T> {
  nodes: TreeNode<T>[]
  /** A file of the tree: the item and the name shown (its last path part). */
  file: (item: T, name: string) => ReactNode
}

export function ChangeTree<T>({ nodes, file }: ChangeTreeProps<T>) {
  const [closed, setClosed] = useState<Record<string, boolean>>({})

  return (
    <div className="flex min-w-0 flex-col">
      {nodes.map((node) => {
        if (node.type === 'folder') {
          const isClosed = Boolean(closed[node.path])
          return (
            <Collapsible
              key={node.path}
              open={!isClosed}
              onOpenChange={(open) => setClosed((prev) => ({ ...prev, [node.path]: !open }))}
              className="group/folder min-w-0"
            >
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" className="w-full min-w-0 justify-start text-ui font-normal">
                  <ChevronRightIcon
                    data-icon="inline-start"
                    className="transition-transform group-data-[state=open]/folder:rotate-90"
                    aria-hidden="true"
                  />
                  {isClosed ? <FolderIcon aria-hidden="true" /> : <FolderOpenIcon aria-hidden="true" />}
                  <span className="min-w-0 truncate" title={node.path}>
                    {node.name}
                  </span>
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="ml-4 flex min-w-0 flex-col">
                  <ChangeTree nodes={node.children} file={file} />
                </div>
              </CollapsibleContent>
            </Collapsible>
          )
        }
        return <Fragment key={node.path}>{file(node.item, node.name)}</Fragment>
      })}
    </div>
  )
}

export default ChangeTree
