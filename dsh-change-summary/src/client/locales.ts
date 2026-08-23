/**
 * `change-summary` namespace dictionaries.
 *
 * The namespace registers through the untyped `LocaleRuntime.register(ns, dicts)`
 * path: the typed overload keys off the `LocaleNamespaceMap` merge table, whose
 * owning package (`@deepseek-ai/dsh-client-ui-slots`) is not part of the shipped
 * DSH bundle, so the merge table cannot be extended here. The dictionaries still
 * carry a local key union so the component can type its `t(...)` calls.
 */

/** Local key union of the `change-summary` namespace. */
export interface ChangeSummaryKey {
  'change.workspace': string
  'change.outside': string
  'change.open': string
  'change.openDeleted': string
  'change.deleted': string
}

/** `change-summary` namespace id. */
export const NS = 'change-summary'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh: ChangeSummaryKey = {
  'change.workspace': '工作区修改',
  'change.outside': '工作区外修改',
  'change.open': '打开 {name}',
  'change.openDeleted': '查看 {name} 的删除 diff',
  'change.deleted': '已删除',
}

/** English dictionary (same key set). */
export const en: ChangeSummaryKey = {
  'change.workspace': 'Workspace changes',
  'change.outside': 'Outside workspace',
  'change.open': 'Open {name}',
  'change.openDeleted': 'View deleted {name} diff',
  'change.deleted': 'deleted',
}
