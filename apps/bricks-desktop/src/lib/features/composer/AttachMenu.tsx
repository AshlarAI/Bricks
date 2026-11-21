import { useRef } from 'react'
import { cn } from '$lib/utils'
import { t, useLanguage } from '$lib/i18n/i18n'
import { open } from '@tauri-apps/plugin-dialog'
import { buttonVariants } from '$lib/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '$lib/components/ui/dropdown-menu'
import { errorMessage } from '$lib/ipc/client'
import { FileIcon, FolderIcon, PlusIcon, SparklesIcon } from 'lucide-react'

export interface AttachMenuProps {
  disabled?: boolean
  onPick: (paths: string[], kind: 'file' | 'folder') => void
  onError: (message: string) => void
  /** Opens the skills choice of the composer (the menu entry is shown only when given). */
  onSkills?: () => void
}

export function AttachMenu({ disabled = false, onPick, onError, onSkills }: AttachMenuProps) {
  useLanguage()
  /** Set when the skills choice was asked: the menu must not give the focus back to its trigger. */
  const skillsAskedRef = useRef(false)

  /** Native picker (several items at once); the paths are real file-system paths. */
  async function pick(kind: 'file' | 'folder') {
    try {
      const folder = kind === 'folder'
      const picked = await open({
        multiple: true,
        directory: folder,
        title: folder ? t('composer.chooseFolders') : t('composer.chooseFiles'),
      })
      const paths = picked === null ? [] : Array.isArray(picked) ? picked : [picked]
      if (paths.length > 0) onPick(paths, kind)
    } catch (e) {
      onError(errorMessage(e))
    }
  }

  function askSkills() {
    skillsAskedRef.current = true
    onSkills?.()
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          buttonVariants({ variant: 'ghost', size: 'icon-compact' }),
          'rounded-full border border-border bg-card text-muted-foreground hover:bg-element-hover hover:text-foreground data-[state=open]:border-border-strong data-[state=open]:bg-element-selected',
        )}
        disabled={disabled}
        aria-label={t('composer.attachAFileOrFolder')}
        title={t('composer.attach')}
      >
        <PlusIcon aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        side="top"
        onCloseAutoFocus={(event) => {
          if (!skillsAskedRef.current) return
          // The skills choice takes the focus it opens with.
          skillsAskedRef.current = false
          event.preventDefault()
        }}
      >
        <DropdownMenuItem onSelect={() => void pick('file')}>
          <FileIcon aria-hidden="true" />
          {t('composer.files')}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void pick('folder')}>
          <FolderIcon aria-hidden="true" />
          {t('composer.folder')}
        </DropdownMenuItem>
        {onSkills && (
          <DropdownMenuItem onSelect={askSkills}>
            <SparklesIcon aria-hidden="true" />
            {t('composer.skills')}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export default AttachMenu
