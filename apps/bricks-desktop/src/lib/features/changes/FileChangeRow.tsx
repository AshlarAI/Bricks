import { useEffect, useRef, useState, type ReactNode } from 'react'
import { t, useLanguage } from '$lib/i18n/i18n'
import { Badge } from '$lib/components/ui/badge'
import { Button } from '$lib/components/ui/button'
import DiffStat from '$lib/layout/DiffStat'
import FileIcon from '$lib/features/file-icons/FileIcon'
import { errorMessage, type FileDiff } from '$lib/ipc/client'
import DiffView from './DiffView'
import { baseName, dirName } from './format'
import type { PatchSource } from './types'

export interface FileChangeRowProps {
  path: string
  /** Name shown for the file. Default: the path, its folder dimmed. In a tree: the last part. */
  name?: string
  /** Change label shown beside the path, e.g. « Modifié ». */
  status?: string
  /** Added and removed counts. `null` or absent: not known, nothing is shown. */
  added?: number | null
  removed?: number | null
  binary?: boolean
  /** Short labels of the agents that made the change. */
  agents?: string[]
  /** What the counts measure. Shown next to the figures. */
  countLabel?: string
  /** Extra line under the path, e.g. the original path of a rename. */
  note?: string
  /** Patches loaded when the row is expanded. None: the row cannot expand. */
  patches?: PatchSource[]
  /** Controls shown beside the row, outside its toggle (e.g. a link). */
  actions?: ReactNode
}

export function FileChangeRow({
  path,
  name,
  status,
  added,
  removed,
  binary = false,
  agents = [],
  countLabel,
  note,
  patches = [],
  actions,
}: FileChangeRowProps) {
  useLanguage()

  const [expanded, setExpanded] = useState(false)
  const [loaded, setLoaded] = useState<Record<string, { diff?: FileDiff; error?: string }>>({})
  /** Keys already requested. Ref, not state: it only prevents duplicate loads. */
  const requestedRef = useRef<Set<string>>(new Set())
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const expandable = patches.length > 0
  const hasCounts = !binary && added != null && removed != null

  // Load the patches of an expanded row, once per key. A changed key (for
  // example a newer git status) loads again on its own.
  useEffect(() => {
    if (!expanded) return
    for (const source of patches) {
      if (requestedRef.current.has(source.key)) continue
      requestedRef.current.add(source.key)
      source
        .load()
        .then((diff) => {
          if (!mountedRef.current) return
          setLoaded((prev) => ({ ...prev, [source.key]: { diff } }))
        })
        .catch((e: unknown) => {
          requestedRef.current.delete(source.key)
          if (!mountedRef.current) return
          setLoaded((prev) => ({ ...prev, [source.key]: { error: errorMessage(e) } }))
        })
    }
  }, [expanded, patches])

  const folder = dirName(path)

  return (
    <div className="min-w-0">
      <div className="flex min-w-0 items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          className="h-auto min-h-7 min-w-0 flex-1 justify-start py-1 text-ui font-normal disabled:opacity-100 aria-expanded:bg-element-selected"
          aria-expanded={expandable ? expanded : undefined}
          disabled={!expandable}
          title={path}
          onClick={() => setExpanded((prev) => !prev)}
        >
          <FileIcon path={path} />
          <span className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
            <span className="flex w-full min-w-0 items-center gap-2">
              <span className="min-w-0 truncate">
                {name ? (
                  name
                ) : (
                  <>
                    {folder ? <span className="text-muted-foreground">{folder}/</span> : null}
                    {baseName(path)}
                  </>
                )}
              </span>
              <span className="ml-auto flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                {status ? <span>{status}</span> : null}
                {agents.length > 0 && <span className="max-w-32 truncate">{agents.join(', ')}</span>}
                {binary ? (
                  <Badge variant="outline">{t('changes.binary')}</Badge>
                ) : hasCounts ? (
                  <DiffStat additions={added ?? 0} deletions={removed ?? 0} label={countLabel} />
                ) : null}
              </span>
            </span>
            {note ? <span className="max-w-full truncate text-xs text-muted-foreground">{note}</span> : null}
          </span>
        </Button>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </div>

      {expanded && (
        <div className="flex flex-col gap-3 pt-1 pr-1 pb-3 pl-6">
          {patches.map((source) => {
            const entry = loaded[source.key]
            return (
              <div key={source.key} className="flex flex-col gap-1">
                <p className="text-xs text-muted-foreground">{source.title}</p>
                {entry?.diff ? (
                  <DiffView patch={entry.diff.patch} truncated={entry.diff.truncated} binary={entry.diff.binary} />
                ) : entry?.error ? (
                  <p role="alert" className="text-xs text-destructive">
                    {t('changes.couldNotLoadTheDiff', { error: entry.error })}
                  </p>
                ) : (
                  <p aria-live="polite" className="text-xs text-muted-foreground">
                    {t('common.loading')}
                  </p>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default FileChangeRow
