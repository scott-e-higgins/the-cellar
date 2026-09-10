export type WineDraft = Record<string, string> & { name: string; winery_id: string; vintage: string; non_vintage: string }
export type AcquisitionLine = { id: string; wineId: string; draft: WineDraft | null; quantity: string; location: string; price: string; currentValue: string }
export const blankWine = (winery: string): WineDraft => ({ name: '', winery_id: winery, vintage: '', non_vintage: 'false', closure: 'Cork' })
export const numeric = (value: string | undefined) => value?.trim() ? Number(value) : null
export function acquisitionItems(lines: AcquisitionLine[], gift: boolean) {
  return lines.map((line) => {
    const quantity = Number(line.quantity), price = gift ? null : numeric(line.price)
    if ([price, numeric(line.currentValue)].some((value) => value !== null && (!Number.isFinite(value) || value < 0))) throw new Error('Enter a valid non-negative bottle price or value.')
    if (!Number.isInteger(quantity) || quantity < 1) throw new Error('Enter a whole number of bottles for each wine.')
    if (!line.location) throw new Error('Choose where to put each wine.')
    if (!line.wineId && !line.draft?.name.trim()) throw new Error('Choose or name each wine.')
    return { wine_id: line.wineId || null, new_wine: line.draft ? { ...line.draft, name: line.draft.name.trim(), non_vintage: line.draft.non_vintage === 'true', vintage: line.draft.non_vintage === 'true' ? null : numeric(line.draft.vintage) } : undefined, quantity, storage_location_id: line.location, unit_price: price, total_cost: price === null ? null : Math.round(price * quantity * 100) / 100, current_value_per_bottle: gift ? null : numeric(line.currentValue) ?? price }
  })
}
