// Confirmation of `/quit` while a run is active: it lists the conversations
// with a run in progress, then closes the application through the native
// command.
import { t, useLanguage } from '$lib/i18n/i18n'
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
import { appQuit } from '$lib/ipc/client'
import { app } from '$lib/state/app'

export interface QuitDialogProps {
  /** Titles of the conversations with a run in progress; `null` when closed. */
  runs: string[] | null
  onClose: () => void
}

export function QuitDialog({ runs, onClose }: QuitDialogProps) {
  useLanguage()

  async function quit() {
    try {
      await appQuit()
    } catch (e) {
      app.fail(e)
      onClose()
    }
  }

  return (
    <AlertDialog
      open={runs !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('commands.quitBricks')}</AlertDialogTitle>
          <AlertDialogDescription>{t('commands.aGenerationIsRunningInThese')}</AlertDialogDescription>
        </AlertDialogHeader>
        <ul className="list-disc pl-5 text-sm">
          {(runs ?? []).map((title, i) => (
            <li key={i}>{title}</li>
          ))}
        </ul>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('commands.stay')}</AlertDialogCancel>
          <AlertDialogAction onClick={() => void quit()}>{t('commands.quit')}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export default QuitDialog
