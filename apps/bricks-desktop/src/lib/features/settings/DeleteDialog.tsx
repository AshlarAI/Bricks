// Confirmation of a deletion in the models settings. The write is passed in; a failure stays
// in the dialog so the user can read it. Mounted only while it is open.
import { useState } from 'react'
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
import { t, useLanguage } from '$lib/i18n/i18n'
import type { WriteOutcome } from './models'

export interface DeleteDialogProps {
  title: string
  description: string
  /** Set when the dialog was reopened after the file changed elsewhere. */
  notice?: string | null
  /** Runs the deletion and resolves with its outcome. */
  onConfirm: () => Promise<WriteOutcome>
  /** The dialog must go: closed by the user, or after the deletion succeeded. */
  onClose: () => void
}

export function DeleteDialog({
  title,
  description,
  notice = null,
  onConfirm,
  onClose,
}: DeleteDialogProps) {
  useLanguage()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function confirm() {
    if (busy) return
    setBusy(true)
    setError(null)
    const outcome = await onConfirm()
    setBusy(false)
    if (outcome.ok) onClose()
    else setError(outcome.message)
  }

  return (
    <AlertDialog open onOpenChange={(next) => { if (!next) onClose() }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {notice && (
          <p role="alert" className="text-sm text-pretty text-destructive">
            {notice}
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-pretty text-destructive">
            {error}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>{t('common.cancel')}</AlertDialogCancel>
          <Button variant="destructive" disabled={busy} onClick={() => void confirm()}>
            {t('common.delete')}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export default DeleteDialog
