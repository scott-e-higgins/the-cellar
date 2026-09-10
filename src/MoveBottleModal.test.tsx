// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react'
import {MoveBottleModal} from './MoveBottleModal'
import {bottleMoveGroups} from './lib/bottle-moves'
import {EMPTY_CELLAR_DATA,type CellarData} from './lib/cellar-data'
const api=vi.hoisted(()=>({rpc:vi.fn()}));vi.mock('./lib/supabase',()=>({supabase:{rpc:api.rpc}}))
const normal={id:'a',wineId:'wine',purchaseItemId:'item',storageLocationId:'rack',status:'active',isAging:false,userHoldUntilYear:null,effectiveHoldUntilYear:null}
const data={...EMPTY_CELLAR_DATA,wines:[{id:'wine',name:'Riesling'}],locations:[{id:'rack',name:'Rack',isActive:true},{id:'dest',name:'Section C',isActive:true}],purchaseItems:[{id:'item',purchaseId:'p'}],purchases:[{id:'p',acquisitionDate:'2026-09-05'}],bottles:[normal,{...normal,id:'b'},{...normal,id:'aging',isAging:true,userHoldUntilYear:2032,effectiveHoldUntilYear:2032}]} as unknown as CellarData
const close=vi.fn(),refresh=vi.fn(),notice=vi.fn()
beforeEach(()=>{vi.clearAllMocks();api.rpc.mockResolvedValue({data:1,error:null});refresh.mockResolvedValue(undefined)})
afterEach(cleanup)
const mount=()=>render(<MoveBottleModal wineId="wine" householdId="h" data={data} onClose={close} onSaved={refresh} onNotice={notice}/>);
it('groups equivalent bottles, defaults normal, separates Aging and retains explicit Hold',async()=>{
 const groups=bottleMoveGroups(data,'wine');expect(groups).toHaveLength(2);expect(groups[0].bottles.map(b=>b.id)).toEqual(['a','b']);mount();expect((screen.getByLabelText('Which bottles?') as HTMLSelectElement).value).toBe(groups[0].key);fireEvent.change(screen.getByLabelText('Which bottles?'),{target:{value:groups[1].key}});expect(screen.getByText('Aging and your Hold decision stay with these bottles.')).toBeTruthy();expect(screen.queryByLabelText('How many bottles?')).toBeNull();fireEvent.change(screen.getByLabelText('Move to'),{target:{value:'dest'}});fireEvent.submit(document.querySelector('form')!);await waitFor(()=>expect(close).toHaveBeenCalledOnce());expect(api.rpc.mock.calls[0][1].p_bottle_ids).toEqual(['aging']);expect(api.rpc.mock.calls[0][1]).not.toHaveProperty('is_aging')
})
it('unconfirmed move freezes exact bottle IDs and request for safe retry; no repeated success submission',async()=>{
 api.rpc.mockResolvedValueOnce({error:{message:'network lost'}});mount();fireEvent.change(screen.getByLabelText('How many bottles?'),{target:{value:'2'}});fireEvent.change(screen.getByLabelText('Move to'),{target:{value:'dest'}});fireEvent.submit(document.querySelector('form')!);await screen.findByRole('button',{name:'Retry Move'});expect(screen.getByLabelText('Move to').matches(':disabled')).toBe(true);expect(close).not.toHaveBeenCalled();const first=api.rpc.mock.calls[0][1];fireEvent.submit(document.querySelector('form')!);await waitFor(()=>expect(close).toHaveBeenCalledOnce());expect(api.rpc.mock.calls[1][1]).toEqual(first);expect(first.p_bottle_ids).toEqual(['a','b']);fireEvent.submit(document.querySelector('form')!);expect(api.rpc).toHaveBeenCalledTimes(2)
})
it('confirmed rollback keeps choices editable and does not claim success',async()=>{
 api.rpc.mockResolvedValueOnce({error:{code:'P0001',message:'These bottles changed. Refresh before moving them'}});mount();fireEvent.change(screen.getByLabelText('Move to'),{target:{value:'dest'}});fireEvent.submit(document.querySelector('form')!);await screen.findByRole('alert');expect(close).not.toHaveBeenCalled();expect(screen.getByLabelText('Move to').matches(':disabled')).toBe(false);expect(notice).not.toHaveBeenCalled()
})
