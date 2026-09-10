import type {CellarData} from './cellar-data'
export type EntryContext={departureType?:'opened'|'gifted';wineryId?:string|null;visitId?:string|null;tripId?:string|null;date?:string|null;purchaseId?:string|null;locationId?:string|null;purchaseLocation?:string|null}
export function inferEntryContext(data:CellarData,wineryId:string,date:string,visitChoice:string|undefined,tripChoice:string|undefined){
 const visits=data.visits.filter(v=>v.wineryId===wineryId&&v.visitDate===date)
 const visitId=visitChoice!==undefined?visitChoice:visits.length===1?visits[0].id:''
 const visitTrips=[...new Set(data.travelReferences.filter(r=>r.wineryVisitId===visitId).map(r=>r.externalId))]
 const visitTrip=visitTrips.length===1?visitTrips[0]:''
 const trips=data.trips.filter(t=>Boolean(date&&t.startDate&&t.endDate)&&t.startDate<=date&&t.endDate>=date)
 const tripId=tripChoice!==undefined?tripChoice:visitTrip|| (visitTrips.length===0&&trips.length===1?trips[0].id:'')
 return {visitId,tripId,visits,trips,visitTrip,ambiguousVisit:visitChoice===undefined&&visits.length>1,ambiguousTrip:tripChoice===undefined&&(visitTrips.length>1||(!visitTrip&&trips.length>1)),conflict:!!(visitTrip&&tripChoice!==undefined&&tripChoice!==visitTrip)}
}
