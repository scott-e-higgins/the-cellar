import type { CellarData } from './cellar-data'
export type AuditBottle = { id: string; wine_id: string; purchase_item_id: string; location_id: string; is_aging: boolean; hold: number | null; updated_at: string }
export type AuditObservation = { actual: number; confirmed: boolean; reason: string; remove_ids: string[]; moves: { id: string; location_id: string; is_aging: boolean; hold: number | null }[] }
export type InventoryAudit = { id: string; location_id: string; status: 'counting'|'applied'|'cancelled'; snapshot: AuditBottle[]; observations: Record<string, AuditObservation>; revision: number; applied_at: string | null; created_at: string }
export type AuditLocation = { id: string; name: string; active_audit: InventoryAudit | null; last_audit: InventoryAudit | null; changed_since_audit: boolean }
export function auditWines(audit: InventoryAudit) { return [...new Set([...audit.snapshot.map(b => b.wine_id), ...Object.keys(audit.observations)])] }
export function expectedBottles(audit: InventoryAudit, wineId: string) { return audit.snapshot.filter(b => b.wine_id === wineId) }
export function auditDelta(audit: InventoryAudit, wineId: string) { const o = audit.observations[wineId]; return o ? o.actual - expectedBottles(audit, wineId).length - o.moves.length : 0 }
export function auditSummary(audit: InventoryAudit) {
 const ids = auditWines(audit), values = Object.values(audit.observations)
 return { expected: audit.snapshot.length, confirmed: ids.filter(id => audit.observations[id]?.confirmed).length, wines: ids.length,
  correct: ids.reduce((n,id) => n + (audit.observations[id]?.confirmed && auditDelta(audit,id) === 0 && !audit.observations[id]?.moves.length ? expectedBottles(audit,id).length : 0),0),
  discrepancies: ids.filter(id => auditDelta(audit,id) !== 0).length, moves: values.reduce((n,o)=>n+o.moves.length,0),
  unlisted: ids.filter(id=>expectedBottles(audit,id).length===0 && audit.observations[id]?.actual>0).length }
}
export function auditBottleGroups(bottles: AuditBottle[], data: CellarData) {
 const groups = new Map<string,{label:string;ids:string[]}>()
 for (const b of bottles) {
  const item=data.purchaseItems.find(i=>i.id===b.purchase_item_id), purchase=data.purchases.find(p=>p.id===item?.purchaseId)
  const key=JSON.stringify([b.location_id,purchase?.acquisitionDate,item?.unitPrice,b.is_aging,b.hold])
  if(!groups.has(key)) groups.set(key,{label:[data.locations.find(l=>l.id===b.location_id)?.name,purchase?.acquisitionDate,b.is_aging?`Aging${b.hold?` · Hold ${b.hold}`:''}`:'Ready bottles'].filter(Boolean).join(' · '),ids:[]})
  groups.get(key)!.ids.push(b.id)
 }
 return [...groups.values()]
}
