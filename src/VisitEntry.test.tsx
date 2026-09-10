// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react'
import {WorkflowModal} from './WorkflowModal'
import {EMPTY_CELLAR_DATA,type CellarData} from './lib/cellar-data'
const api=vi.hoisted(()=>({rpc:vi.fn()}));vi.mock('./lib/supabase',()=>({supabase:{rpc:api.rpc}}))
const data={...EMPTY_CELLAR_DATA,wineries:[{id:'w',name:'Forge'}],trips:[{id:'t',name:'Finger Lakes',startDate:'2026-09-04',endDate:'2026-09-07'},{id:'other',name:'Maine',startDate:'2026-10-09',endDate:'2026-10-17'}]} as CellarData
const close=vi.fn(),refresh=vi.fn(),notice=vi.fn()
beforeEach(()=>{vi.clearAllMocks();api.rpc.mockResolvedValue({data:'visit',error:null});refresh.mockResolvedValue(undefined)})
afterEach(cleanup)
const mount=(context=false,d=data)=>render(<WorkflowModal action="add-winery-visit" householdId="h" data={d} initialWineryId={context?'w':null} initialDate="2026-09-05" onClose={close} onSaved={refresh} onNotice={notice}/>);
const change=(name:string,value:string)=>fireEvent.change(screen.getByLabelText(name),{target:{value}})
const submit=()=>fireEvent.submit(document.querySelector('form')!)
it('global Visit starts compact, searches and selects Winery, infers the Trip and closes on save',async()=>{
 mount();expect(screen.queryByRole('group',{name:'Matching wineries'})).toBeNull();change('Winery','For');fireEvent.click(screen.getByRole('button',{name:'Forge'}));expect(screen.queryByRole('group',{name:'Matching wineries'})).toBeNull();expect(screen.getByText('Trip: Finger Lakes ✓')).toBeTruthy();submit();await waitFor(()=>expect(close).toHaveBeenCalledOnce());expect(api.rpc).toHaveBeenCalledWith('save_winery_visit',expect.objectContaining({p_fields:expect.objectContaining({winery_id:'w',trip_mode:'auto',trip_id:'t',visit_date:'2026-09-05'})}))
})
it('Winery context is preselected and no matching date leaves the Visit unlinked',async()=>{
 mount(true);expect((screen.getByLabelText('Winery') as HTMLInputElement).value).toBe('Forge');expect(screen.queryByRole('group',{name:'Matching wineries'})).toBeNull();change('Visit date','2026-08-01');expect(screen.getByText('Trip: Not linked')).toBeTruthy();submit();await waitFor(()=>expect(close).toHaveBeenCalled());expect(api.rpc.mock.calls[0][1].p_fields).toMatchObject({winery_id:'w',trip_id:null,trip_mode:'auto'})
})
it('inline creation works with an empty Winery collection and submits one atomic request',async()=>{
 mount(false,{...data,wineries:[]});change('Winery','New Cellars');fireEvent.click(screen.getByRole('button',{name:'+ Add “New Cellars”'}));expect(screen.queryByRole('group',{name:'Matching wineries'})).toBeNull();change('Winery location (optional)','Geneva');expect(api.rpc).not.toHaveBeenCalled();submit();await waitFor(()=>expect(close).toHaveBeenCalledOnce());expect(api.rpc).toHaveBeenCalledOnce();expect(api.rpc.mock.calls[0][1].p_fields).toMatchObject({winery_id:null,new_winery_name:'New Cellars',new_winery_city:'Geneva'})
})
it('overlapping Trips require a decision; choosing unlinked is explicit and remains so after date changes',async()=>{
 mount(true,{...data,trips:[...data.trips,{...data.trips[0],id:'overlap',name:'Overlapping trip'}]});submit();expect(api.rpc).not.toHaveBeenCalled();change('Travel Journal trip','');change('Visit date','2026-10-10');expect(screen.getByText('Trip: Not linked')).toBeTruthy();submit();await waitFor(()=>expect(close).toHaveBeenCalled());expect(api.rpc.mock.calls[0][1].p_fields).toMatchObject({trip_mode:'manual',trip_id:null})
})
it('manual Trip survives date and Winery changes until Use date match is chosen',async()=>{
 mount(true);change('Travel Journal trip','other');change('Visit date','2026-09-06');change('Winery','For');fireEvent.click(screen.getByRole('button',{name:'Forge'}));expect(screen.getByText('Trip: Maine ✓')).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'Use date match'}));expect(screen.getByText('Trip: Finger Lakes ✓')).toBeTruthy();submit();await waitFor(()=>expect(close).toHaveBeenCalled());expect(api.rpc.mock.calls[0][1].p_fields.trip_mode).toBe('auto')
})
it('a confirmed failed save preserves the inline draft and request ID for retry',async()=>{
 mount();change('Winery','New Cellars');fireEvent.click(screen.getByRole('button',{name:'+ Add “New Cellars”'}));api.rpc.mockResolvedValueOnce({error:{code:'P0001',message:'Temporary failure'}});submit();await screen.findByRole('alert');const first=api.rpc.mock.calls[0][1];expect(close).not.toHaveBeenCalled();submit();await waitFor(()=>expect(close).toHaveBeenCalled());expect(api.rpc.mock.calls[1][1]).toEqual(first)
})
