export function normalizeClosure(value?: string | null) {
  return value?.toLowerCase().includes('screw') ? 'Screwtop' : 'Cork'
}

export function ClosureSelect({ defaultValue }: { defaultValue?: string | null }) {
  return <label>Closure<select name="closure" defaultValue={normalizeClosure(defaultValue)}><option value="Cork">Cork</option><option value="Screwtop">Screwtop</option></select></label>
}
