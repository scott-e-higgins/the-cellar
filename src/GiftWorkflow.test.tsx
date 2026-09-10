// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react'
import {WorkflowModal} from './WorkflowModal'
import {EMPTY_CELLAR_DATA,type CellarData} from './lib/cellar-data'
const api=vi.hoisted(()=>({rpc:vi.fn()}));vi.mock('./lib/supabase',()=>({supabase:{rpc:api.rpc}}))
const normal={wineLabel:'Riesling',wineId:'wine',purchaseItemId:'item',purchaseId:'purchase',storageLocationId:'rack',storageLocationName:'Rack',quantity:2,normalQuantity:2,agingQuantity:0,earliestHoldUntilYear:null}
const data={...EMPTY_CELLAR_DATA,wines:[{id:'wine',name:'Riesling',availableQuantity:2}],bottleLots:[normal],purchases:[{id:'purchase',acquisitionDate:'2026-09-04'}]} as unknown as CellarData
const close=vi.fn(),refresh=vi.fn(),notice=vi.fn()
beforeEach(()=>{vi.clearAllMocks();api.rpc.mockResolvedValue({data:'gift',error:null});refresh.mockResolvedValue(undefined)})
afterEach(cleanup)
function mount(lots=data.bottleLots){render(<WorkflowModal action="open-bottle" initialDepartureType="gifted" initialWineId="wine" householdId="household" data={{...data,bottleLots:lots}} onClose={close} onSaved={refresh} onNotice={notice}/>)}
it.each([1,3])('%s equivalent bottles need no picker and gift exactly one normal bottle',async(count)=>{
 mount(Array.from({length:count},(_,i)=>({...normal,purchaseItemId:`item${i}`})));expect(screen.queryByLabelText('Bottle and location')).toBeNull();fireEvent.change(screen.getByLabelText('Gifted to'),{target:{value:'Friend'}});fireEvent.submit(document.querySelector('form')!);await waitFor(()=>expect(close).toHaveBeenCalledOnce());expect(api.rpc).toHaveBeenCalledOnce();expect(api.rpc).toHaveBeenCalledWith('gift_bottle_v2',expect.objectContaining({p_purchase_item_id:'item0',p_gifted_to:'Friend',p_confirm_aging:false}));fireEvent.submit(document.querySelector('form')!);expect(api.rpc).toHaveBeenCalledOnce()
})
it('normal plus Aging defaults normal, with only relevant choices and explicit Aging confirmation',()=>{
 mount([{...normal,purchaseItemId:'aging',normalQuantity:0,agingQuantity:2,earliestHoldUntilYear:2030},normal]);const select=screen.getByLabelText('Bottle and location') as HTMLSelectElement;expect(select.value).toBe('item|rack');expect(screen.queryByText('This is an Aging bottle.')).toBeNull();fireEvent.change(select,{target:{value:'aging|rack'}});expect(screen.getByText('This is an Aging bottle.')).toBeTruthy();expect((document.querySelector('[name="confirm_aging"]') as HTMLInputElement).required).toBe(true)
})
it('only Aging requires confirmation; failure preserves the gift draft, then successful retry closes',async()=>{
 mount([{...normal,normalQuantity:0,agingQuantity:2,earliestHoldUntilYear:2030}]);expect(screen.queryByLabelText('Bottle and location')).toBeNull();expect(screen.getByText('This is an Aging bottle.')).toBeTruthy();fireEvent.change(screen.getByLabelText('Gifted to'),{target:{value:'Friend'}});fireEvent.click(document.querySelector('[name="confirm_aging"]')!);api.rpc.mockResolvedValueOnce({error:{code:'P0001',message:'Temporary save failure'}});fireEvent.submit(document.querySelector('form')!);await screen.findByRole('alert');expect(close).not.toHaveBeenCalled();expect((screen.getByLabelText('Gifted to') as HTMLInputElement).value).toBe('Friend');fireEvent.submit(document.querySelector('form')!);await waitFor(()=>expect(close).toHaveBeenCalledOnce());expect(api.rpc.mock.calls[1][1].p_confirm_aging).toBe(true)
})
