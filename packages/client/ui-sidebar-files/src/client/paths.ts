/**
 * Path arithmetic the tree's rows and menus need: the last segment, the parent
 * directory, and a path relative to the tab's root.
 *
 * Every path here is one the tree keys a row by (`face.ts`'s `childPath`), so
 * `/` is the separator the tree mints itself; a Host-reported path may also
 * carry `\`, and both are read.
 */

/**
 * The last segment of a path: a row's display name, and the name a rename
 * dialog pre-fills.
 * @param path - absolute path.
 * @returns the last segment, or the path itself when it has none.
 */
export function entryName(path: string): string {
  const trimmed = path.replace(/[/\\]+$/, '')
  if (trimmed === '') return path
  const at = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  return trimmed.slice(at + 1)
}

/**
 * The parent directory of a path.
 * @param path - absolute path.
 * @returns the parent's absolute path, or the path itself when it has no parent.
 */
export function parentPath(path: string): string {
  const trimmed = path.replace(/[/\\]+$/, '')
  const at = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  if (at < 0) return path
  if (at === 0) return trimmed.slice(0, 1)
  const parent = trimmed.slice(0, at)
  // `C:` alone is a drive, not a directory: its parent is the drive's root.
  return parent.endsWith(':') ? `${parent}\\` : parent
}

/**
 * A path as the tree's root sees it.
 * @param root - absolute path the tab is rooted at.
 * @param path - absolute path of the entry.
 * @returns the path relative to the root; unchanged when it lies outside.
 */
export function relativeToRoot(root: string, path: string): string {
  const base = root.replace(/[/\\]+$/, '')
  if (path === root) return ''
  return path.startsWith(`${base}/`) ? path.slice(base.length + 1) : path
}
