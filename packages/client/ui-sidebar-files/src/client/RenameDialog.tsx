/**
 * The rename dialog: one entry's new name, validated before the Host is asked.
 *
 * The name is one path segment, so a blank name and one carrying a separator
 * are refused here — the Host would refuse them too, and telling the reader
 * before the round trip is the difference between a validation and an error.
 * Until the name differs from the current one, confirming would be a no-op, so
 * the confirm button stays disabled. A failure the Host does report stays in
 * the dialog, with the name the reader typed still there to correct.
 */
import { useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from './locales.ts'
import css from './FilesBody.module.css'

/** Whether one typed name is a usable single path segment. */
export function validEntryName(name: string): boolean {
  return name.trim() !== '' && !/[/\\]/.test(name)
}

/** Everything the rename dialog draws and the rename it performs. */
export interface RenameDialogProps {
  /** The entry's current basename, pre-filled and selected. */
  readonly name: string
  /** Namespace-bound translate. */
  readonly t: TranslateNS<'sidebarFiles'>
  /**
   * Rename the entry.
   * @param newName - the name the reader confirmed.
   * @returns a localized failure line, or null when the Host accepted it.
   */
  readonly onConfirm: (newName: string) => Promise<string | null>
  /** Dismiss the dialog. */
  readonly onClose: () => void
}

/**
 * Render the rename dialog.
 * @param props - see {@link RenameDialogProps}.
 * @returns the dialog element.
 */
export function RenameDialog({ name, t, onConfirm, onClose }: RenameDialogProps): ReactNode {
  const [draft, setDraft] = useState(name)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  // Pre-filled and selected: typing replaces the old name, Enter accepts it.
  useLayoutEffect(() => { inputRef.current?.select() }, [])

  const confirm = (): void => {
    setBusy(true)
    setFailure(null)
    void onConfirm(draft).then((line) => {
      setBusy(false)
      if (line === null) onClose()
      else setFailure(line)
    })
  }
  const invalid = !validEntryName(draft)
  return (
    <Modal
      open
      title={t('rename.title')}
      closeLabel={t('dialog.close')}
      onClose={onClose}
      footer={(
        <>
          <Button variant="outline" onClick={onClose}>{t('dialog.cancel')}</Button>
          <Button
            variant="primary"
            data-rename-confirm
            disabled={busy || invalid || draft === name}
            onClick={confirm}
          >
            {t('rename.confirm')}
          </Button>
        </>
      )}
    >
      <input
        ref={inputRef}
        className={css.dialogInput}
        data-rename-input
        aria-label={t('rename.input')}
        value={draft}
        onChange={(event) => { setDraft(event.target.value) }}
      />
      {invalid && <p className={css.dialogError} role="alert" data-rename-invalid>{t('rename.invalid')}</p>}
      {failure !== null && <p className={css.dialogError} role="alert" data-rename-failure>{failure}</p>}
    </Modal>
  )
}
