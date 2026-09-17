/**
 * The delete dialog: one confirmation naming the entry, then the removal.
 *
 * Deletion is refused nowhere else: the reader confirmed it, and the Host is
 * the only party that knows whether the entry can go. A failure it reports
 * stays in the dialog, which keeps its confirm button so the reader can try
 * again.
 */
import { useState } from 'react'
import type { ReactNode } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from './locales.ts'
import css from './FilesBody.module.css'

/** Everything the delete dialog draws and the removal it performs. */
export interface DeleteDialogProps {
  /** The entry's basename, named in the confirmation. */
  readonly name: string
  /** Namespace-bound translate. */
  readonly t: TranslateNS<'sidebarFiles'>
  /**
   * Remove the entry.
   * @returns a localized failure line, or null when the Host accepted it.
   */
  readonly onConfirm: () => Promise<string | null>
  /** Dismiss the dialog. */
  readonly onClose: () => void
}

/**
 * Render the delete confirmation.
 * @param props - see {@link DeleteDialogProps}.
 * @returns the dialog element.
 */
export function DeleteDialog({ name, t, onConfirm, onClose }: DeleteDialogProps): ReactNode {
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const confirm = (): void => {
    setBusy(true)
    setFailure(null)
    void onConfirm().then((line) => {
      setBusy(false)
      if (line === null) onClose()
      else setFailure(line)
    })
  }
  return (
    <Modal
      open
      title={t('delete.title')}
      description={t('delete.description', { name })}
      closeLabel={t('dialog.close')}
      onClose={onClose}
      footer={(
        <>
          <Button variant="outline" onClick={onClose}>{t('dialog.cancel')}</Button>
          <Button
            variant="outline"
            className={css.dangerButton}
            data-delete-confirm
            disabled={busy}
            onClick={confirm}
          >
            {t('delete.confirm')}
          </Button>
        </>
      )}
    >
      {failure !== null && <p className={css.dialogError} role="alert" data-delete-failure>{failure}</p>}
    </Modal>
  )
}
