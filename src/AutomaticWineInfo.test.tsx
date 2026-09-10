// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react'
import {AcquisitionModal} from './AcquisitionModal'
import {EMPTY_CELLAR_DATA,type CellarData} from './lib/cellar-data'
import {WINE_LOOKUP_DELAY} from './WineInfoLookup'
const api=vi.hoisted(()=>({rpc:vi.fn(),invoke:vi.fn()}))
vi.mock('./lib/supabase',()=>({supabase:{rpc:api.rpc,functions:{invoke:api.invoke}}}))
const data={...EMPTY_CELLAR_DATA,wineries:[{id:'w',name:'Forge'},{id:'other',name:'Other Winery'}],locations:[{id:'rack',name:'Rack',isActive:true}]} as CellarData
const complete=vi.fn(),close=vi.fn()
const response=(id='a',type='exact')=>({data:{attempt:{id,status:'ready_for_review',confidence:type==='exact'?'high':'medium',match_type:type,match_explanation:'Review the producer and vintage.',proposed_data:{official_name:id,producer:'Forge',vintage:2023,category:'White Wine'}},sources:[{source_name:'Producer',source_url:'https://example.com/wine'}]},error:null})
const mount=(extra={})=>render(<AcquisitionModal action="add-wine" householdId="h" data={data} initialWineryId="w" onSaved={async()=>{}} onClose={close} onNotice={()=>{}} onComplete={complete} {...extra}/>)
const change=(label:string,value:string)=>fireEvent.change(screen.getByLabelText(label),{target:{value}})
const tick=async(ms=WINE_LOOKUP_DELAY)=>act(async()=>{await vi.advanceTimersByTimeAsync(ms)})
const flush=async()=>act(async()=>{await Promise.resolve()})
beforeEach(()=>{vi.useFakeTimers();vi.clearAllMocks();api.invoke.mockResolvedValue(response());api.rpc.mockResolvedValue({data:{wine_ids:['wine'],winery_id:'w',purchase_id:'p'},error:null})})
afterEach(()=>{cleanup();vi.useRealTimers()})
it('waits for selected winery, name and complete vintage, then debounces typing',async()=>{
 mount({initialWineryId:null});change('Winery','Forge');change('Wine name','Riesling');change('Vintage','2023');await tick();expect(api.invoke).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'Forge'}));change('Vintage','202');await tick();expect(api.invoke).not.toHaveBeenCalled();change('Vintage','2023');await tick(700);change('Wine name','Riesling Dry');await tick(700);expect(api.invoke).not.toHaveBeenCalled();await tick(300);expect(api.invoke).toHaveBeenCalledOnce();expect(api.invoke.mock.calls[0][1].body.draft).toMatchObject({name:'Riesling Dry',vintage:2023,winery_name:'Forge'});expect(screen.getByText('Wine info found ✓')).toBeTruthy();expect(api.rpc).not.toHaveBeenCalled()
})
it('keeps quantity, storage, cancel and Save usable during lookup; late result cannot mutate saved wine',async()=>{
 let resolve!:(value:ReturnType<typeof response>)=>void;api.invoke.mockImplementation(()=>new Promise(r=>{resolve=r}));mount();change('Wine name','Riesling');change('Vintage','2023');await tick();expect((screen.getByRole('button',{name:'Save'}) as HTMLButtonElement).disabled).toBe(false);expect((screen.getByRole('button',{name:'Cancel'}) as HTMLButtonElement).disabled).toBe(false);change('Quantity','3');fireEvent.submit(document.querySelector('form')!);await flush();expect(complete).toHaveBeenCalledOnce();expect(api.rpc.mock.calls[0][1].p_lines[0]).toMatchObject({quantity:3,enrichment_attempt_id:null});await act(async()=>resolve(response()));expect(api.rpc).toHaveBeenCalledOnce();expect((screen.getByRole('button',{name:'Use Info'}) as HTMLButtonElement).disabled).toBe(true)
})
it('only includes research in save after explicit Use Info',async()=>{
 mount();change('Wine name','Riesling');change('Vintage','2023');await tick();expect(api.rpc).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'Use Info'}));fireEvent.submit(document.querySelector('form')!);await flush();expect(api.rpc.mock.calls[0][1].p_lines[0].enrichment_attempt_id).toBe('a');expect(api.rpc.mock.calls[0][1].p_lines[0].new_wine.category).toBeUndefined()
})
it('does not silently include an unaccepted strong result',async()=>{
 mount();change('Wine name','Riesling');change('Vintage','2023');await tick();fireEvent.submit(document.querySelector('form')!);await flush();expect(api.rpc.mock.calls[0][1].p_lines[0].enrichment_attempt_id).toBeNull()
})
it('discards out-of-order results when identity changes and clears accepted info',async()=>{
 let old!:(value:ReturnType<typeof response>)=>void;api.invoke.mockImplementationOnce(()=>new Promise(r=>{old=r})).mockResolvedValue(response('new'));mount();change('Wine name','Old Wine');change('Vintage','2023');await tick();change('Wine name','New Wine');await tick();expect(screen.getAllByText('new').length).toBeGreaterThan(0);await act(async()=>old(response('old')));expect(screen.queryByText('old')).toBeNull();fireEvent.click(screen.getByRole('button',{name:'Use Info'}));change('Winery','Other Winery');expect(screen.queryByText('✓ Information selected')).toBeNull();expect(screen.queryByRole('button',{name:'Use Info'})).toBeNull()
})
it('coalesces automatic/manual requests and identical wine lines',async()=>{
 mount();change('Wine name','Riesling');change('Vintage','2023');fireEvent.click(screen.getByRole('button',{name:'Find Wine Info'}));await flush();await tick();fireEvent.click(screen.getByRole('button',{name:'Find Wine Info'}));await flush();change('Quantity','4');await tick();expect(api.invoke).toHaveBeenCalledOnce();fireEvent.click(screen.getByRole('button',{name:'Add another wine before saving'}));fireEvent.change(screen.getAllByLabelText('Wine name')[1],{target:{value:'Riesling'}});fireEvent.change(screen.getAllByLabelText('Vintage')[1],{target:{value:'2023'}});await tick();expect(api.invoke).toHaveBeenCalledOnce();expect(screen.getAllByText('Wine info found ✓')).toHaveLength(2)
})
it('labels ambiguity for review without selecting it',async()=>{
 api.invoke.mockResolvedValue(response('ambiguous','ambiguous'));mount();change('Wine name','Riesling');change('Vintage','2023');await tick();expect(screen.getByText('Wine info needs review')).toBeTruthy();expect(screen.queryByText('Wine info found ✓')).toBeNull();fireEvent.submit(document.querySelector('form')!);await flush();expect(api.rpc.mock.calls[0][1].p_lines[0].enrichment_attempt_id).toBeNull()
})
it.each(['no_match','failure'])('%s is nonblocking and manual retry remains available',async(mode)=>{
 api.invoke.mockResolvedValueOnce(mode==='failure'?{error:new Error('offline')}:{data:{attempt:{id:'a',status:'no_match',proposed_data:{}}}});mount();change('Wine name','Riesling');change('Vintage','2023');await tick();expect(screen.queryByRole('alert')).toBeNull();expect(screen.queryByRole('button',{name:'Use Info'})).toBeNull();await tick(5000);expect(api.invoke).toHaveBeenCalledOnce();fireEvent.click(screen.getByRole('button',{name:'Find Wine Info'}));await flush();expect(api.invoke).toHaveBeenCalledTimes(2);expect(screen.getByText('Wine info found ✓')).toBeTruthy()
})
it('cancels scheduled lookup on leaving and supports explicit non-vintage identity',async()=>{
 const view=mount();change('Wine name','Blend');change('Vintage','2023');view.unmount();await tick();expect(api.invoke).not.toHaveBeenCalled();mount();change('Wine name','Blend');fireEvent.click(screen.getByLabelText('Non-vintage'));await tick();expect(api.invoke.mock.calls[0][1].body.draft).toMatchObject({vintage:null,non_vintage:true})
})
it('looks up selected existing wines in Add Bottles through the same preview engine',async()=>{
 mount({action:'record-purchase',data:{...data,wines:[{id:'wine',wineryId:'w',name:'Riesling',vintage:2023,nonVintage:false}]}});change('Wine name','Ries');fireEvent.click(screen.getByRole('button',{name:'Use Riesling · 2023'}));await tick();expect(api.invoke.mock.calls[0][1].body.action).toBe('preview_wine');expect(screen.getByText('Wine info found ✓')).toBeTruthy()
})
