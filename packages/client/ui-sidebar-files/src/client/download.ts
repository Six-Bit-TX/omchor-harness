/**
 * Handing one file the reader asked to download to the browser.
 *
 * The bytes arrive base64 on the wire; everything from there on is the
 * document's: decode, wrap in a `Blob`, hand it to a synthetic anchor, and take
 * the object URL back. Nothing here awaits, and nothing outlives the click.
 */

/**
 * Save one base64 payload as a download named `name`.
 * @param name - the file name the browser offers.
 * @param base64 - the file's complete content, base64-encoded.
 */
export function saveBase64File(name: string, base64: string): void {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  const url = URL.createObjectURL(new Blob([bytes]))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  URL.revokeObjectURL(url)
}
