/** Test-only renderer bindings for props-driven component tests. */
import { useSyncExternalStore } from 'react'
import type { ObservableSnapshot, SnapshotSelectorHook } from '@deepseek-ai/dsh-client-store'

export function bindSnapshotSelector<Value>(source: ObservableSnapshot<Value>): SnapshotSelectorHook<Value> {
  return select => select(useSyncExternalStore(source.subscribe, source.getSnapshot))
}

export function makeTranslate(dictionary: Record<string, string>, common: Record<string, string> = {}) {
  return (key: string, fields?: Readonly<Record<string, string | number>>): string => {
    let text = dictionary[key] ?? common[key] ?? key
    for (const [name, value] of Object.entries(fields ?? {})) text = text.replaceAll(`{${name}}`, String(value))
    return text
  }
}
