import { useId, useMemo, useRef, useState } from 'react'
import {
  EllipsisVerticalIcon,
  FolderIcon,
  FolderOpenIcon,
  FolderXIcon,
  PencilIcon,
  PlusIcon,
  TrashIcon,
} from 'lucide-react'
import { t, useLanguage } from '$lib/i18n/i18n'
import type { Project } from '$lib/ipc/client'
import { app, useApp } from '$lib/state/app'
import { Button } from '$lib/components/ui/button'
import { Input } from '$lib/components/ui/input'
import { Field, FieldError, FieldLabel } from '$lib/components/ui/field'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '$lib/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '$lib/components/ui/alert-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '$lib/components/ui/dropdown-menu'
import { cn } from '$lib/utils'
import ConversationList from './ConversationList'

/** Conversations listed under a project before « Afficher plus ». */
const SHOWN_PER_PROJECT = 3

export function ProjectList() {
  useLanguage()
  const uid = useId()
  const folders = useApp((s) => s.folders)
  const collapsedProjects = useApp((s) => s.collapsedProjects)
  const currentProjectId = useApp((s) => s.currentProjectId)
  const currentSessionId = useApp((s) => s.currentSessionId)
  const sessionsByProject = useApp((s) => s.sessionsByProject)
  const pinnedIds = useApp((s) => s.prefs.pinned_sessions)

  // The dialogs are rendered once, outside the menus, so they outlive the menu closing.
  const [renameTarget, setRenameTarget] = useState<Project | null>(null)
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameName, setRenameName] = useState('')
  const [renameError, setRenameError] = useState<string | null>(null)
  const [renaming, setRenaming] = useState(false)

  const [removeTarget, setRemoveTarget] = useState<Project | null>(null)
  const [removeOpen, setRemoveOpen] = useState(false)

  // Set when a menu item opens a dialog: the menu must not hand focus back to its trigger.
  const keepFocusRef = useRef(false)
  const pinnedSet = useMemo(() => new Set(pinnedIds ?? []), [pinnedIds])

  function toggle(project: Project) {
    app.toggleProjectCollapsed(project.id)
  }

  // A project whose folder is missing asks for its new place first (in app.newConversation).
  function startConversation(project: Project) {
    if (!app.hasProviders) return
    if (app.collapsedProjects.has(project.id)) app.toggleProjectCollapsed(project.id)
    void app.newConversation(project.id)
  }

  function onMenuClose(event: Event) {
    if (keepFocusRef.current) event.preventDefault()
    keepFocusRef.current = false
  }

  function openRename(project: Project) {
    keepFocusRef.current = true
    setRenameTarget(project)
    setRenameName(project.name)
    setRenameError(null)
    setRenameOpen(true)
  }

  function openRemove(project: Project) {
    keepFocusRef.current = true
    setRemoveTarget(project)
    setRemoveOpen(true)
  }

  async function submitRename(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const target = renameTarget
    if (!target || renaming) return
    const name = renameName.trim()
    if (!name) {
      setRenameError(t('navigation.giveTheProjectAName'))
      return
    }
    if (name === target.name) {
      setRenameOpen(false)
      return
    }
    setRenaming(true)
    const before = app.lastError
    await app.renameProject(target.id, name)
    setRenaming(false)
    // renameProject reports failures through app.lastError (shown as a toast): keep the dialog open.
    if (app.lastError === before) setRenameOpen(false)
  }

  function confirmRemove() {
    const target = removeTarget
    if (target) void app.removeProject(target.id)
  }

  return (
    <>
      <ul className="flex flex-col gap-2" aria-label={t('navigation.projects')}>
        {folders.map((project) => {
          const expanded = !collapsedProjects.has(project.id)
          const drafting = project.id === currentProjectId && currentSessionId === null
          const hasUnpinnedSessions = (sessionsByProject.get(project.id) ?? []).some((s) => !pinnedSet.has(s.id))

          return (
            <li key={project.id}>
              <div
                className={cn(
                  'group flex items-center gap-1 rounded-lg pr-1 transition-colors',
                  drafting ? 'bg-element-selected text-foreground' : 'hover:bg-element-hover',
                )}
              >
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left"
                  aria-expanded={expanded}
                  aria-describedby={project.missing ? `${uid}-${project.id}-missing` : undefined}
                  title={project.path}
                  onClick={() => toggle(project)}
                >
                  {project.missing ? (
                    <FolderXIcon className="size-4 shrink-0 text-destructive" aria-hidden="true" />
                  ) : expanded ? (
                    <FolderOpenIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  ) : (
                    <FolderIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  )}
                  <span className="truncate text-compact font-medium">{project.name}</span>
                </button>
                {project.missing && (
                  <span id={`${uid}-${project.id}-missing`} className="sr-only">
                    {t('navigation.folderNotFound')}
                  </span>
                )}

                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="shrink-0 text-muted-foreground opacity-0 group-focus-within:opacity-100 group-hover:opacity-100"
                  aria-label={t('navigation.newConversationIn', { name: project.name })}
                  onClick={() => startConversation(project)}
                >
                  <PlusIcon aria-hidden="true" />
                </Button>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="shrink-0 text-muted-foreground opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"
                      aria-label={t('navigation.actionsForProject', { name: project.name })}
                    >
                      <EllipsisVerticalIcon aria-hidden="true" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-44" onCloseAutoFocus={onMenuClose}>
                    <DropdownMenuItem onSelect={() => openRename(project)}>
                      <PencilIcon className="size-4" aria-hidden="true" />
                      {t('navigation.rename2')}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onSelect={() => openRemove(project)}>
                      <TrashIcon className="size-4" aria-hidden="true" />
                      {t('navigation.removeFromBricks')}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              {expanded && hasUnpinnedSessions && (
                <div className="mt-0.5">
                  <ConversationList
                    projectId={project.id}
                    label={t('navigation.conversationsOf', { name: project.name })}
                    limit={SHOWN_PER_PROJECT}
                    nested
                  />
                </div>
              )}
            </li>
          )
        })}
      </ul>

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent showCloseButton={false} className="sm:max-w-sm">
          <form onSubmit={(e) => void submitRename(e)} className="flex flex-col gap-6">
            <DialogHeader>
              <DialogTitle>{t('navigation.renameTheProject')}</DialogTitle>
            </DialogHeader>
            <Field data-invalid={renameError ? 'true' : undefined}>
              <FieldLabel htmlFor={`${uid}-name`}>{t('navigation.projectName')}</FieldLabel>
              <Input
                id={`${uid}-name`}
                value={renameName}
                onChange={(e) => setRenameName(e.target.value)}
                maxLength={120}
                autoComplete="off"
                aria-invalid={renameError ? 'true' : undefined}
                aria-describedby={renameError ? `${uid}-error` : undefined}
              />
              {renameError && <FieldError id={`${uid}-error`}>{renameError}</FieldError>}
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setRenameOpen(false)}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={renaming}>
                {t('common.save')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={removeOpen} onOpenChange={setRemoveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('navigation.removeFromBricks2', { value: removeTarget?.name ?? '' })}
            </AlertDialogTitle>
            <AlertDialogDescription>{t('navigation.theProjectLeavesBricksListThe')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmRemove}>{t('navigation.remove')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

export default ProjectList
