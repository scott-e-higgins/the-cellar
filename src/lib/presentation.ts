import type { CellarData, PurchaseRecord, VisitRecord, WineRecord, WineryRecord } from './cellar-data'
export const displayValue = (value: string | null | undefined) => value ? ({cork:'Cork',screwtop:'Screwtop',yes:'Yes',no:'No',maybe:'Maybe'}[value.toLowerCase()] ?? value) : value
export const displayDate = (value: string) => new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric'}).format(new Date(value.length===10?`${value}T12:00:00`:value))
export function sortWines(wines: WineRecord[], sort: string) {
 return [...wines].sort((a,b)=> (sort==='name'?a.name.localeCompare(b.name):sort==='winery'?(a.wineryName??'').localeCompare(b.wineryName??''):sort==='vintage'?(b.vintage??0)-(a.vintage??0):(b.createdAt??'').localeCompare(a.createdAt??'')) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
}
const string=(value:unknown)=>typeof value==='string'?value.trim():''
export function wineryContact(winery: WineryRecord,data:CellarData) {
 const accepted=data.wineryOnlineInfo.find(x=>x.entityId===winery.id)?.acceptedData??{}
 const pick=(manual:string|null|undefined,key:string)=>string(manual)||string(accepted[key])
 const website=pick(winery.websiteUrl,'website_url');let websiteUrl=''
 try { const url=new URL(/^https?:\/\//i.test(website)?website:`https://${website}`);if(website && ['http:','https:'].includes(url.protocol))websiteUrl=url.href }catch{/* malformed source is displayed as text only */}
 const phone=pick(winery.contactPhone,'phone'),email=pick(winery.contactEmail,'email')
 const street=pick(winery.address,'street_address'),city=pick(winery.city,'city'),state=pick(winery.state,'state_province'),country=pick(winery.country,'country'),postal=string(accepted.postal_code)
 const address=[street,city,state,postal,country].filter(Boolean).join(', ')
 return {websiteUrl,phone,email,address,mapUrl:street&&(city||postal)?`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${winery.name}, ${address}`)}`:null, sourced:(!winery.websiteUrl&&!!website)||(!winery.contactPhone&&!!phone)||(!winery.contactEmail&&!!email)||(!winery.address&&!!street)}
}
export function purchaseMatch(data:CellarData,visit:VisitRecord,purchase:PurchaseRecord) {
 const days=purchase.acquisitionDate?Math.abs(Date.parse(`${purchase.acquisitionDate}T12:00:00Z`)-Date.parse(`${visit.visitDate}T12:00:00Z`))/86400000:null
 const sameWinery=data.purchaseItems.some(item=>item.purchaseId===purchase.id&&data.wines.some(w=>w.id===item.wineId&&w.wineryId===visit.wineryId))
 const vt=data.travelReferences.find(r=>r.wineryVisitId===visit.id)?.externalId,pt=data.travelReferences.find(r=>r.purchaseId===purchase.id)?.externalId
 const tripConflict=Boolean(vt&&pt&&vt!==pt)
 return {days,likely:sameWinery&&days!==null&&days<=3&&!tripConflict,warning:tripConflict?'This purchase belongs to a different trip. Linking will use this visit’s trip.':days===null?'This purchase has no date. Check that it belongs to this visit.':days>7?`This purchase is ${Math.round(days)} days away from the visit. Keep both dates and link anyway?`:!sameWinery?'The wines are from a different winery. Check this association.':null}
}
