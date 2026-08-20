export type NavigationContext<TTab extends string> = { scrollTop: number; tab: TTab }

export function nextRecordContext<TTab extends string>({ previousDepth, nextDepth, saved, defaultTab }: { previousDepth: number; nextDepth: number; saved?: NavigationContext<TTab>; defaultTab: TTab }): NavigationContext<TTab> {
  return nextDepth < previousDepth && saved ? saved : { scrollTop: 0, tab: defaultTab }
}
