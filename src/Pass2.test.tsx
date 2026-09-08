// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { AcquisitionModal } from './AcquisitionModal'
import { WorkflowModal } from './WorkflowModal'
import { OpeningReviewForm } from './OpeningReviewForm'
import { EMPTY_CELLAR_DATA, type CellarData, type OpeningRecord } from './lib/cellar-data'
import { wineClassification } from './lib/wine-classification'
const api=vi.hoisted(()=>({rpc:vi.fn()}))
vi.mock('./lib/supabase',()=>({supabase:{rpc:api.rpc}}))
const data={...EMPTY_CELLAR_DATA,wineries:[{id:'winery',name:'Forge'}],wines:[{id:'wine',name:'Riesling',wineryId:'winery',wineryName:'Forge',availableQuantity:3},{id:'other',name:'Other Wine',availableQuantity:1}],locations:[{id:'rack',name:'Rack',isActive:true}],people:[{id:'scott',displayName:'Scott'},{id:'kay',displayName:'Kay'}],trips:[{id:'trip',name:'Wine country'}],purchases:[{id:'purchase',acquisitionDate:'2026-08-01'}],bottleLots:[{wineId:'wine',purchaseId:'purchase',purchaseItemId:'aging',storageLocationId:'rack',storageLocationName:'Rack',wineLabel:'Riesling',quantity:2,normalQuantity:0,agingQuantity:2},{wineId:'wine',purchaseId:'purchase',purchaseItemId:'normal',storageLocationId:'rack',storageLocationName:'Rack',wineLabel:'Riesling',quantity:1,normalQuantity:1,agingQuantity:0},{wineId:'other',purchaseItemId:'otherlot',storageLocationId:'rack',storageLocationName:'Rack',wineLabel:'Other Wine',quantity:1,normalQuantity:1,agingQuantity:0}]} as unknown as CellarData
const saved=vi.fn(),close=vi.fn(),notice=vi.fn()
beforeEach(()=>{vi.clearAllMocks();api.rpc.mockResolvedValue({data:'saved-id',error:null});saved.mockResolvedValue(undefined)})
afterEach(cleanup)
const change=(label:string,value:string)=>fireEvent.change(screen.getByLabelText(label),{target:{value}})
const submit=async()=>{fireEvent.submit(document.querySelector('form')!);await waitFor(()=>expect(screen.queryByText('Saving…')).toBeNull())}
const acquire=(action:'add-wine'|'record-purchase'='add-wine')=>render(<AcquisitionModal action={action} householdId="household" data={data} initialWineryId="winery" initialVisitId={action==='record-purchase'?'visit':undefined} initialDate="2026-08-01" initialTripId={action==='record-purchase'?'trip':undefined} onSaved={saved} onClose={close} onNotice={notice}/> )
it('new Wine continues to quantity/location and saves once with acquisition context',async()=>{
 acquire();change('Wine name','New Riesling');change('Vintage','2024');fireEvent.click(screen.getByRole('button',{name:'Continue to bottles'}));expect(api.rpc).not.toHaveBeenCalled();change('Quantity','3');change('Price per bottle (optional)','20');await submit();
 expect(api.rpc).toHaveBeenCalledWith('save_acquisition',expect.objectContaining({p_definition_only:false,p_details:expect.objectContaining({acquisition_date:'2026-08-01',subtotal:60,total_cost:60,purchase_location:'Forge'}),p_lines:[expect.objectContaining({new_wine:expect.objectContaining({name:'New Riesling',vintage:2024,winery_id:'winery'}),quantity:3,storage_location_id:'rack'})]}));expect(close).toHaveBeenCalledOnce()
})
it('definition-only save never requires inventory fields',async()=>{acquire();change('Wine name','Reference wine');fireEvent.click(screen.getByLabelText('Save wine without adding bottles'));await submit();expect(api.rpc.mock.calls[0][1]).toMatchObject({p_definition_only:true,p_lines:[{new_wine:expect.objectContaining({name:'Reference wine'})}]})})
it('mixed visit purchase includes an existing wine and in-context new wine with shared trip/date',async()=>{
 acquire('record-purchase');change('Wine','wine');fireEvent.click(screen.getByRole('button',{name:'Add another wine'}));fireEvent.click(screen.getAllByRole('button',{name:'Create a missing wine'})[1]);change('Wine name','Missing Red');await submit();const payload=api.rpc.mock.calls[0][1];expect(payload.p_details).toMatchObject({visit_id:'visit',trip_id:'trip',acquisition_date:'2026-08-01'});expect(payload.p_lines).toHaveLength(2);expect(payload.p_lines[0].wine_id).toBe('wine');expect(payload.p_lines[1].new_wine).toMatchObject({name:'Missing Red',winery_id:'winery'});expect(api.rpc).toHaveBeenCalledOnce()
})
it('uncertain acquisition retry reuses the exact payload and id; successful refresh failure prevents another save',async()=>{
 api.rpc.mockResolvedValueOnce({error:{message:'Network failed'}});acquire('record-purchase');change('Wine','wine');await submit();expect(screen.getByRole('button',{name:'Retry Save'})).toBeTruthy();expect((screen.getByLabelText('Wine') as HTMLSelectElement).matches(':disabled')).toBe(true);saved.mockRejectedValueOnce(new Error('refresh failed'));await submit();expect(api.rpc.mock.calls[1][1]).toEqual(api.rpc.mock.calls[0][1]);expect(notice).toHaveBeenCalledWith('Saved, but the screen could not refresh.','warning');await submit();expect(api.rpc).toHaveBeenCalledTimes(2)
})
it.each(['Opened','Gifted'])('%s starts with only selected wine lots, prefers normal, and changes wine separately',async(kind)=>{
 render(<WorkflowModal action="open-bottle" householdId="household" data={data} initialWineId="wine" onSaved={saved} onClose={close} onNotice={notice}/>);
 const lot=screen.getByLabelText('Bottle and location') as HTMLSelectElement;expect(lot.options).toHaveLength(3);expect(lot.value).toContain('normal');expect(lot.textContent).toContain('2026-08-01');expect(lot.textContent).not.toContain('Other Wine');
 if(kind==='Gifted'){fireEvent.click(screen.getByLabelText('Gifted',{exact:true}));change('Gifted to','Friend')}
 await submit();expect(api.rpc.mock.calls[0][1].p_purchase_item_id).toBe('normal');if(kind==='Opened')expect(api.rpc.mock.calls[0][1].p_status).toBe('open')
})
it('Change Wine exposes search and selects that wine’s normal lot',()=>{
 render(<WorkflowModal action="open-bottle" householdId="household" data={data} initialWineId="wine" onSaved={saved} onClose={close} onNotice={notice}/>);fireEvent.click(screen.getByRole('button',{name:'Change Wine'}));change('Wine','other');expect((screen.getByLabelText('Bottle and location') as HTMLSelectElement).value).toContain('otherlot')
})
it('finish later preserves Kay’s existing half-rating and saves Scott edits without inventory RPCs',async()=>{
 const opening={id:'opening',wineId:'wine',status:'open',openedAt:'2026-08-01T12:00:00Z',openedBy:'Both'} as OpeningRecord
 render(<OpeningReviewForm opening={opening} data={{...data,reviews:[{id:'review',openingId:'opening',personId:'kay',rating:3.5,buyAgain:'maybe',tastingNotes:'Original Kay note'}]}} householdId="household" finishing onCancel={close} onSaved={saved} onNotice={notice} setBusy={vi.fn()}/>);
 const scott=screen.getByRole('group',{name:'Scott'});fireEvent.click(within(scott).getByRole('button',{name:'5 stars'}));fireEvent.change(within(scott).getByLabelText('Tasting notes'),{target:{value:'Scott note'}});fireEvent.change(within(scott).getByLabelText('Buy again'),{target:{value:'yes'}});await submit();expect(api.rpc).toHaveBeenCalledWith('save_opening_review',expect.objectContaining({p_opening_id:'opening',p_fields:expect.objectContaining({status:'finished',opened_by_both:true}),p_reviews:[expect.objectContaining({person_id:'scott',rating:5,buy_again:'yes',tasting_notes:'Scott note'}),expect.objectContaining({person_id:'kay',rating:3.5,buy_again:'maybe',tasting_notes:'Original Kay note'})]}));expect(api.rpc).toHaveBeenCalledOnce()
})
it('accepted classification is sourced and manual values always win; proposals do not count',()=>{
 const wine=data.wines[0];const enriched={wineOnlineInfo:[{entityId:'wine',acceptedData:{category:'Red Wine',style:'Dry'}}]} as unknown as CellarData
 expect(wineClassification(wine,enriched)).toMatchObject({category:'Red Wine',label:'Red Wine',labelSourced:true});expect(wineClassification({...wine,category:'White Wine'},enriched)).toMatchObject({category:'White Wine',label:'White Wine',labelSourced:false});expect(wineClassification({...wine,style:'Rosé'},enriched)).toMatchObject({style:'Rosé',label:'Rosé',labelSourced:false});expect(wineClassification(wine,{wineOnlineInfo:[]})).toMatchObject({category:null,style:null})
})
