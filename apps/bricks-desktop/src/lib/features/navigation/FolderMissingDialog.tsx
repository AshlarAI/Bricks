// « Dossier de travail introuvable »: shown while an action waits for a project
// whose folder is missing. Choosing its new place moves the project and its
// conversations there, then the action goes on. Mounted once, by App.tsx.
import { useState } from 'react'
import { t, useLanguage } from '$lib/i18n/i18n'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '$lib/components/ui/alert-dialog'
import { Button } from '$lib/components/ui/button'
import { app, useApp } from '$lib/state/app'

export function FolderMissingDialog() {
  useLanguage()
  const folderRequest = useApp((s) => s.folderRequest)
  const projects = useApp((s) => s.projects)
  const [choosing, setChoosing] = useState(false)

  const project = folderRequest ? (projects.find((p) => p.id === folderRequest.projectId) ?? null) : null

  async function choose() {
    if (choosing) return
    setChoosing(true)
    try {
      await app.chooseFolder()
    } finally {
      setChoosing(false)
    }
  }

  function onOpenChange(open: boolean) {
    if (!open) app.cancelFolderRequest()
  }

  return (
    <AlertDialog open={folderRequest !== null} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('navigation.workingFolderNotFound')}</AlertDialogTitle>
          {project && (
            <AlertDialogDescription className="break-all">
              {project.name} · <span className="font-mono text-xs">{project.path}</span>
            </AlertDialogDescription>
          )}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
          <Button onClick={() => void choose()} disabled={choosing}>
            {t('navigation.chooseAFolder')}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export default FolderMissingDialog
