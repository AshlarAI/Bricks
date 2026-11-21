// A top-level ```diff / ```patch fence: a proposal written in the answer,
// shown read-only with the change views' DiffView. Its counts are the
// proposal's own, never the conversation's Git statistics. Nothing here
// applies, commits or runs the patch.
import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronRightIcon } from 'lucide-react'
import { t, useLanguage } from '$lib/i18n/i18n'
import { Button } from '$lib/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '$lib/components/ui/collapsible'
import FileIcon from '$lib/features/file-icons/FileIcon'
import DiffView from '$lib/features/changes/DiffView'
import { patchFiles } from '$lib/features/changes/patch'
import type { FileReference } from './types'

export interface DiffBlockProps {
  source: string
  complete: boolean
  /** Opens a file of the conversation's project; absent when the conversation has none. */
  onFile?: (ref: FileReference) => void
}

export function DiffBlock({ source, complete, onFile }: DiffBlockProps) {
  useLanguage()

  const files = useMemo(() => patchFiles(source), [source])
  const [copied, setCopied] = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      clearTimeout(timerRef.current)
    }
  }, [])

  async function copyPatch() {
    let status: string
    try {
      await navigator.clipboard.writeText(source)
      status = t('common.copied')
    } catch {
      status = t('common.couldNotCopy')
    }
    if (!mountedRef.current) return
    setCopied(status)
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      if (mountedRef.current) setCopied(null)
    }, 1500)
  }

  return (
    <div className="diff-block my-2 overflow-hidden rounded-md bg-code-bg text-xs text-code-foreground">
      <div className="flex items-center justify-between gap-2 px-2.5 py-1 text-muted-foreground">
        <span className="font-mono">diff{complete ? '' : '…'}</span>
        <Button variant="ghost" size="xs" onClick={() => void copyPatch()}>
          {copied ?? t('common.copy')}
        </Button>
      </div>
      {files.map((file, i) => (
        <Collapsible key={i} defaultOpen>
          <div className="flex items-center gap-1.5 px-1.5 py-0.5">
            <CollapsibleTrigger
              className="group inline-flex items-center gap-1 rounded-sm px-1 py-0.5 text-muted-foreground hover:bg-element-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              aria-label={
                file.path
                  ? t('conversation.showOrHide', { path: file.path })
                  : t('conversation.showOrHideTheDiff')
              }
            >
              <ChevronRightIcon
                className="size-3.5 transition-transform group-data-[state=open]:rotate-90"
                aria-hidden="true"
              />
            </CollapsibleTrigger>
            {file.path && onFile ? (
              <button
                type="button"
                className="-mx-1 inline-flex min-w-0 items-center gap-1.5 rounded-sm px-1 py-0.5 transition-colors hover:bg-element-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                onClick={() => onFile({ path: file.path! })}
              >
                <FileIcon path={file.path} />
                <span className="file-ref min-w-0 truncate">{file.path}</span>
              </button>
            ) : file.path ? (
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <FileIcon path={file.path} />
                <span className="min-w-0 truncate font-medium">{file.path}</span>
              </span>
            ) : (
              <span className="font-mono">patch</span>
            )}
            <span className="ml-auto tabular-nums">
              {(file.additions > 0 || file.deletions === 0) && (
                <span className="text-diff-add">+{file.additions}</span>
              )}
              {file.deletions > 0 && <span className="text-diff-del">−{file.deletions}</span>}
            </span>
          </div>
          <CollapsibleContent>
            <DiffView patch={file.patch} binary={file.binary} loose className="rounded-none border-0" />
          </CollapsibleContent>
        </Collapsible>
      ))}
    </div>
  )
}

export default DiffBlock
