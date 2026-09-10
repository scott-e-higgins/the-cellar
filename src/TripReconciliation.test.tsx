// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react'
import {TripReconciliation,type TripMatch} from './TripReconciliation'
import {EMPTY_CELLAR_DATA,type CellarData} from './lib/cellar-data'
import {inferEntryContext} from './lib/entry-context'
const api=vi.hoisted(()=>({rpc:vi.fn()}));vi.mock('./lib/supabase',()=>({supabase:{rpc:api.rpc}}))
const row:TripMatch={purchase_id:'p',status:'needs_review',method:'near',trip_ids:['t'],reason:'Two days outside Trip'}
const data={...EMPTY_CELLAR_DATA,purchases:[{id:'p',acquisitionDate:'2022-11-05'}],purchaseItems:[{id:'i',purchaseId:'p',wineId:'w'}],wines:[{id:'w',name:'Champagne',wineryName:'Krug',vintage:null}],trips:[{id:'t',name:'Honeymoon',startDate:'2022-11-07',endDate:'2022-11-18'},{id:'other',name:'Other Trip',startDate:'2022-12-01',endDate:'2022-12-03'}]} as unknown as CellarData
const refreshed=vi.fn(),notice=vi.fn();let rows:TripMatch[]=[]
beforeEach(()=>{vi.clearAllMocks();sessionStorage.clear();rows=[row];refreshed.mockResolvedValue(undefined);api.rpc.mockImplementation(async(name:string,args:Record<string,string>)=>{if(name==='purchase_trip_queue')return {data:rows,error:null};rows=[{...row,status:args.p_action==='leave_unlinked'?'left_unlinked':'already_linked',trip_ids:args.p_action==='leave_unlinked'?[]:[args.p_trip_id]}];return {data:rows[0],error:null}})})
afterEach(cleanup)
const mount=(editable=true)=>render(<TripReconciliation householdId="h" data={data} editable={editable} onSaved={refreshed} onNotice={notice}/>);
it('shows useful wine/date/Trip context and accepting a suggestion advances without losing filter/search',async()=>{
 mount();await screen.findByText(/Krug · Champagne/);expect(screen.getByText(/Honeymoon.*Nov 7/)).toBeTruthy();fireEvent.change(screen.getByLabelText('Search wines'),{target:{value:'Krug'}});fireEvent.click(screen.getByRole('button',{name:'Accept Suggested Trip'}));await screen.findByText('No acquisitions in this view.');expect(api.rpc).toHaveBeenCalledWith('reconcile_purchase_trip',{p_household_id:'h',p_purchase_id:'p',p_action:'accept',p_trip_id:'t'});expect((screen.getByLabelText('Search wines') as HTMLInputElement).value).toBe('Krug');expect((screen.getByLabelText('Show') as HTMLSelectElement).value).toBe('needs_review')
})
it('Leave Unlinked persists; choosing another Trip saves one acquisition without exposing bottle fields',async()=>{
 mount();await screen.findByRole('button',{name:'Leave Unlinked'});fireEvent.click(screen.getByRole('button',{name:'Leave Unlinked'}));await screen.findByText('No acquisitions in this view.');fireEvent.change(screen.getByLabelText('Show'),{target:{value:'left_unlinked'}});fireEvent.click(screen.getByRole('button',{name:'Choose Different Trip'}));fireEvent.change(screen.getByLabelText('Travel Journal Trip'),{target:{value:'other'}});fireEvent.click(screen.getByRole('button',{name:'Save Trip'}));await waitFor(()=>expect(screen.queryByLabelText('Travel Journal Trip')).toBeNull());expect(api.rpc).toHaveBeenLastCalledWith('purchase_trip_queue',{p_household_id:'h'});expect(api.rpc.mock.calls.filter(c=>c[0]==='reconcile_purchase_trip').map(c=>c[1].p_action)).toEqual(['leave_unlinked','accept'])
})
it('ambiguous suggestions list both choices and never offer one-click guessed acceptance',async()=>{
 rows=[{...row,trip_ids:['t','other']}];mount();await screen.findByText(/Krug · Champagne/);expect(screen.queryByRole('button',{name:'Accept Suggested Trip'})).toBeNull();expect(screen.getByText(/Other Trip.*Dec 1/)).toBeTruthy()
})
it('existing suspicious links stay read-only and viewers cannot make decisions',async()=>{
 rows=[{...row,status:'already_linked',warning:'Date outside linked Trip'}];sessionStorage.setItem('cellar.tripReview.filter','all');const view=mount();await screen.findByRole('alert');expect(screen.queryByRole('button',{name:'Choose Different Trip'})).toBeNull();view.unmount();rows=[row];mount(false);await screen.findByText(/Krug · Champagne/);expect(screen.queryByRole('button',{name:'Accept Suggested Trip'})).toBeNull()
})
it('failed decision can retry safely; successful mutation with refresh failure does not invite resubmission',async()=>{
 mount();await screen.findByRole('button',{name:'Accept Suggested Trip'});api.rpc.mockResolvedValueOnce({error:{message:'offline'}});fireEvent.click(screen.getByRole('button',{name:'Accept Suggested Trip'}));await screen.findByRole('alert');expect(screen.getByRole('button',{name:'Accept Suggested Trip'})).toBeTruthy();refreshed.mockRejectedValueOnce(new Error('offline'));fireEvent.click(screen.getByRole('button',{name:'Accept Suggested Trip'}));await screen.findByText('No acquisitions in this view.');await waitFor(()=>expect(notice).toHaveBeenCalledWith('Saved, but the screen could not refresh.','warning'))
})
it('forward inference uses inclusive dates and refuses to choose between conflicting Visit Trip links',()=>{
 const d={...data,visits:[{id:'v',wineryId:'wr',visitDate:'2022-11-07'}],travelReferences:[{wineryVisitId:'v',externalId:'t'},{wineryVisitId:'v',externalId:'other'}]} as CellarData
 expect(inferEntryContext(d,'wr','2022-11-07',undefined,undefined)).toMatchObject({tripId:'',ambiguousTrip:true});expect(inferEntryContext(data,'wr','2022-11-18',undefined,undefined).tripId).toBe('t');expect(inferEntryContext(data,'wr','2022-11-19',undefined,undefined).tripId).toBe('')
})
