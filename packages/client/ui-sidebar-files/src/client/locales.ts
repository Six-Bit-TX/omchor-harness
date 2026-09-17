/**
 * `sidebarFiles` namespace dictionaries, and the namespace's declaration.
 *
 * The failure lines name what the tree could not list, one code each, because a
 * directory that is gone, one outside the workspace, and a path that is not a
 * directory each suggest a different next step. The mutation, compare, and
 * timeline entries cover the row menu and the dialogs it opens.
 *
 * The namespace merge lives with its key set so that any module naming
 * `TranslateNS<'sidebarFiles'>` or `PropsLocale<'sidebarFiles'>` needs only this
 * file, whichever entry a program loads first.
 */
import type {} from '@deepseek-ai/dsh-client-ui-slots'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** File-tree type name, guide entry, row states, and failure lines. */
    sidebarFiles: SidebarFilesKey
  }
}

/** Simplified Chinese dictionary and key-set source of truth. */
export const zh = {
  'type.label': '文件',
  'guide.title': '工作区文件',
  'guide.description': '浏览会话工作区的文件',
  loading: '正在读取…',
  empty: '空目录',
  truncated: '条目太多，只显示了一部分。',
  noWorkspace: '这个会话没有工作区目录。',
  reload: '重新读取',
  'entry.other': '这不是文件或目录，没法打开。',
  'error.notFound': '这个目录不在了。可能已被移动或删除。',
  'error.outsideWorkspace': '这个目录在工作区之外，侧栏不会读取它。',
  'error.notDirectory': '这不是一个目录。',
  'error.unavailable': '读取失败：{message}',
  'error.tooLarge': '文件太大，无法下载。',
  'error.actionFailed': '操作失败：{message}',
  'path.input': '路径',
  'locations': '跳转到其他位置',
  'locations.workspaces': '工作区',
  'locations.other': '其他位置',
  'locations.cwd': '当前目录',
  'locations.home': '主目录',
  'locations.recent': '最近访问',
  'menu.open': '打开',
  'menu.compareSelect': '选择以进行比较',
  'menu.compareWith': '与已选文件进行比较',
  'menu.timeline': '打开时间线',
  'menu.copyPath': '复制路径',
  'menu.copyRelativePath': '复制相对路径',
  'menu.download': '下载',
  'menu.rename': '重命名',
  'menu.delete': '删除',
  'dialog.cancel': '取消',
  'dialog.close': '关闭',
  'rename.title': '重命名',
  'rename.input': '新名称',
  'rename.confirm': '重命名',
  'rename.invalid': '名称不能为空，也不能包含 “/” 或 “\\”。',
  'delete.title': '删除',
  'delete.description': '确定要删除“{name}”吗？这个操作不能撤销。',
  'delete.confirm': '删除',
  'compare.title': '比较',
  'compare.paths': '{base} ↔ {target}',
  'compare.truncated': '只比较了每个文件的第一页。',
  'timeline.title': '时间线',
  'timeline.empty': '这个文件没有提交历史。',
  'timeline.date': '{y}-{m}-{d} {h}:{mi}',
  'timeline.meta': '{author} · {date}',
  'timeline.counts': '+{additions} −{deletions}',
  'diff.copy': '复制',
  'diff.copied': '已复制',
  'diff.collapse': '收起',
  'diff.expand': '展开 {hidden} 行',
  'diff.collapseAria': '收起隐藏的行',
  'diff.expandAria': '展开 {hidden} 行',
  'diff.files': '{count} 个文件',
} satisfies Record<string, string>

/** Files dictionary key union. */
export type SidebarFilesKey = keyof typeof zh

/** English dictionary, checked against the Chinese key set. */
export const en = {
  'type.label': 'Files',
  'guide.title': 'Workspace files',
  'guide.description': 'Browse files in this session\'s workspace',
  loading: 'Reading…',
  empty: 'Empty directory',
  truncated: 'Too many entries, showing only some of them.',
  noWorkspace: 'This session has no workspace directory.',
  reload: 'Reload',
  'entry.other': 'Not a file or a directory, so it cannot be opened.',
  'error.notFound': 'That directory is gone. It may have been moved or deleted.',
  'error.outsideWorkspace': 'That directory is outside the workspace, so the sidebar will not read it.',
  'error.notDirectory': 'That is not a directory.',
  'error.unavailable': 'Read failed: {message}',
  'error.tooLarge': 'That file is too large to download.',
  'error.actionFailed': 'Action failed: {message}',
  'path.input': 'Path',
  'locations': 'Jump to another location',
  'locations.workspaces': 'Workspaces',
  'locations.other': 'Other locations',
  'locations.cwd': 'Current directory',
  'locations.home': 'Home',
  'locations.recent': 'Recent',
  'menu.open': 'Open',
  'menu.compareSelect': 'Select for Compare',
  'menu.compareWith': 'Compare with Selected',
  'menu.timeline': 'Open Timeline',
  'menu.copyPath': 'Copy Path',
  'menu.copyRelativePath': 'Copy Relative Path',
  'menu.download': 'Download',
  'menu.rename': 'Rename',
  'menu.delete': 'Delete',
  'dialog.cancel': 'Cancel',
  'dialog.close': 'Close',
  'rename.title': 'Rename',
  'rename.input': 'New name',
  'rename.confirm': 'Rename',
  'rename.invalid': 'A name cannot be blank or contain "/" or "\\".',
  'delete.title': 'Delete',
  'delete.description': 'Delete "{name}"? This cannot be undone.',
  'delete.confirm': 'Delete',
  'compare.title': 'Compare',
  'compare.paths': '{base} ↔ {target}',
  'compare.truncated': 'Only the first page of each file was compared.',
  'timeline.title': 'Timeline',
  'timeline.empty': 'This file has no commit history.',
  'timeline.date': '{y}-{m}-{d} {h}:{mi}',
  'timeline.meta': '{author} · {date}',
  'timeline.counts': '+{additions} −{deletions}',
  'diff.copy': 'Copy',
  'diff.copied': 'Copied',
  'diff.collapse': 'Collapse',
  'diff.expand': 'Expand {hidden} lines',
  'diff.collapseAria': 'Collapse the hidden lines',
  'diff.expandAria': 'Expand {hidden} hidden lines',
  'diff.files': '{count} files',
} satisfies Record<SidebarFilesKey, string>
