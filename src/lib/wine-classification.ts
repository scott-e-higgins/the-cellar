import type { CellarData, WineRecord } from './cellar-data'
const text = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : null
export function wineClassification(wine: WineRecord, data: Pick<CellarData, 'wineOnlineInfo'>) {
  const accepted = data.wineOnlineInfo.find((info) => info.entityId === wine.id)
  const category = text(wine.category) ?? text(accepted?.acceptedData.category)
  const style = text(wine.style) ?? text(accepted?.acceptedData.style)
  const label = text(wine.category) ?? text(wine.style) ?? category ?? style
  const labelSourced = !text(wine.category) && !text(wine.style) && Boolean(label)
  return { label, labelSourced, category, style, categorySourced: !text(wine.category) && Boolean(category), styleSourced: !text(wine.style) && Boolean(style) }
}
