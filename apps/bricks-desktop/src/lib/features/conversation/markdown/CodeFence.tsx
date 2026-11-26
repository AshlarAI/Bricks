// A top-level code block of a message: its file or language, then wrap, download and copy,
// and its numbered lines highlighted by Shiki. While it streams, only new lines are tokenized.
// A long block is framed as an artifact, with its size in lines.
import { useState } from 'react'
import { DownloadIcon, FileCodeIcon, WrapTextIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '$lib/components/ui/button'
import {
  Artifact,
  ArtifactActions,
  ArtifactContent,
  ArtifactDescription,
  ArtifactHeader,
  ArtifactTitle,
} from '$lib/components/ui/artifact'
import * as CodeBlock from '$lib/components/ui/code-block'
import FileIcon from '$lib/features/file-icons/FileIcon'
import { languageIconId } from '$lib/features/file-icons/resolve'
import { useHighlightedCode } from '$lib/hooks/use-highlighted-code'
import { t, useLanguage } from '$lib/i18n/i18n'
import { errorMessage, saveTextFile } from '$lib/ipc/client'
import { fenceLanguage } from './extensions'
import { knownLanguage } from './render'

export interface CodeFenceProps {
  source: string
  /** The fence's info string: a language, a path, or both (`ts src/a.ts`). */
  lang: string
  complete: boolean
}

/** Above this many lines, a block is framed as an artifact. */
const ARTIFACT_LINES = 30

/** File extensions of the languages a saved block is most often in. */
const EXTENSIONS: Record<string, string> = {
  bash: 'sh', c: 'c', cpp: 'cpp', csharp: 'cs', css: 'css', go: 'go', html: 'html',
  java: 'java', javascript: 'js', js: 'js', json: 'json', jsx: 'jsx', kotlin: 'kt',
  python: 'py', py: 'py', ruby: 'rb', rust: 'rs', rs: 'rs', sh: 'sh', shell: 'sh',
  sql: 'sql', svelte: 'svelte', swift: 'swift', toml: 'toml', ts: 'ts', tsx: 'tsx',
  typescript: 'ts', xml: 'xml', yaml: 'yml', yml: 'yml', zsh: 'sh',
}

/** The path a fence names (`ts src/a.ts`, or a path alone), or `null`. */
function fencePath(info: string): string | null {
  const words = info.trim().split(/\s+/).filter(Boolean)
  return words.find((w, i) => (i > 0 || languageIconId(fenceLanguage(w)) === null) && /[./\\]/.test(w)) ?? null
}

export function CodeFence({ source, lang, complete }: CodeFenceProps) {
  useLanguage()
  const [wrap, setWrap] = useState(false)
  const language = fenceLanguage(lang)
  const path = fencePath(lang)
  const lines = useHighlightedCode(source, knownLanguage(lang))
  const title = path ?? (language || t('conversation.codeLanguageText'))
  const hasIcon = path !== null || languageIconId(language) !== null
  const fileName = path?.split(/[\\/]/).pop() || `code.${EXTENSIONS[language] ?? 'txt'}`

  async function download() {
    try {
      await saveTextFile(fileName, source)
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  const icon = hasIcon ? (
    <FileIcon path={path} language={path ? null : language} />
  ) : (
    <FileCodeIcon aria-hidden="true" />
  )

  const actions = (size: 'icon-xs' | 'icon-sm') => (
    <>
      <Button
        aria-label={t('conversation.wrapLines')}
        title={t('conversation.wrapLines')}
        aria-pressed={wrap}
        className="text-muted-foreground aria-pressed:text-foreground"
        onClick={() => setWrap(!wrap)}
        size={size}
        variant="ghost"
      >
        <WrapTextIcon aria-hidden="true" />
      </Button>
      <Button
        aria-label={t('conversation.downloadCode')}
        title={t('conversation.downloadCode')}
        className="text-muted-foreground"
        onClick={() => void download()}
        disabled={!complete}
        size={size}
        variant="ghost"
      >
        <DownloadIcon aria-hidden="true" />
      </Button>
      <CodeBlock.CopyButton value={source} size={size} className="text-muted-foreground" />
    </>
  )

  const body = (className: string) => (
    <CodeBlock.Content lineNumbers wrap={wrap} lines={lines} className={className} />
  )

  // A long block is an artifact: a titled frame of its own, its size in lines under the title.
  if (lines.length > ARTIFACT_LINES) {
    return (
      <Artifact className="code-fence my-3 max-h-[36rem]" aria-busy={!complete}>
        <ArtifactHeader className="px-3 py-2">
          <div className="flex min-w-0 items-center gap-2">
            {icon}
            <div className="min-w-0">
              <ArtifactTitle className="font-mono font-normal">{title}</ArtifactTitle>
              <ArtifactDescription className="text-xs">
                {t('webPreview.lines', { count: lines.length })}
              </ArtifactDescription>
            </div>
          </div>
          <ArtifactActions>{actions('icon-sm')}</ArtifactActions>
        </ArtifactHeader>
        <ArtifactContent className="flex flex-col p-0">
          <CodeBlock.Root size="sm" className="min-h-0 flex-1 rounded-none border-0 bg-code-bg text-code-foreground">
            {body('min-h-0 flex-1')}
          </CodeBlock.Root>
        </ArtifactContent>
      </Artifact>
    )
  }

  return (
    <CodeBlock.Root
      size="sm"
      className="code-fence my-3 bg-code-bg text-code-foreground"
      aria-busy={!complete}
    >
      <CodeBlock.Header>
        <CodeBlock.Title className="flex items-center gap-1.5 font-mono font-normal text-muted-foreground *:[svg]:me-0">
          {icon}
          <span className="truncate">{title}</span>
        </CodeBlock.Title>
        <CodeBlock.Actions>{actions('icon-xs')}</CodeBlock.Actions>
      </CodeBlock.Header>
      {body('max-h-[32rem]')}
    </CodeBlock.Root>
  )
}

export default CodeFence
