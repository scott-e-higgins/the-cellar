// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react'
import {HistoryCorrection} from './HistoryCorrection'
import {PhotoImage} from './PhotoImage'
import {PhotoPicker} from './PhotoPicker'
import {EMPTY_CELLAR_DATA,type CellarData,type PurchaseRecord,type GiftRecord} from './lib/cellar-data'
import {purchaseMatch,sortWines,wineryContact,displayValue,displayDate} from './lib/presentation'
import {optimizePhoto} from './lib/photo-optimize'
const api=vi.hoisted(()=>({rpc:vi.fn()}))
vi.mock('./lib/supabase',()=>({supabase:{rpc:api.rpc}}))
const purchase={id:'p',acquisitionDate:'2026-08-01',acquisitionType:'purchased',wineryVisitId:'v',totalCost:25,purchaseLocation:'Winery'} as PurchaseRecord
const data={...EMPTY_CELLAR_DATA,wineries:[{id:'w',name:'Forge'}],wines:[{id:'wine',name:'Riesling',wineryId:'w'}],visits:[{id:'v',wineryId:'w',visitDate:'2026-08-01'},{id:'old',wineryId:'w',visitDate:'2025-08-01'}],purchases:[purchase],purchaseItems:[{id:'i',purchaseId:'p',wineId:'wine'}]} as CellarData
const saved=vi.fn(),close=vi.fn(),notice=vi.fn()
beforeEach(()=>{vi.clearAllMocks();api.rpc.mockResolvedValue({data:'p',error:null});saved.mockResolvedValue(undefined)})
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals()})
const mount=()=>render(<HistoryCorrection kind="purchase" record={purchase} data={data} householdId="h" onCancel={close} onSaved={saved} onNotice={notice}/>)
it('purchase correction unlinks without resubmitting inventory and prevents save after refresh failure',async()=>{
 saved.mockRejectedValue(new Error('offline'));mount();fireEvent.change(screen.getByLabelText('Winery Visit'),{target:{value:''}});fireEvent.change(screen.getByLabelText('Purchase notes'),{target:{value:'Corrected'}});fireEvent.submit(document.querySelector('form')!);await waitFor(()=>expect(close).toHaveBeenCalledOnce());expect(api.rpc).toHaveBeenCalledWith('correct_history_record',expect.objectContaining({p_kind:'purchase',p_record_id:'p',p_fields:{acquisition_date:'2026-08-01',winery_visit_id:null,purchase_location:'Winery',notes:'Corrected',total_cost:'25'}}));expect(notice).toHaveBeenCalledWith('Saved, but the screen could not refresh.','warning');fireEvent.submit(document.querySelector('form')!);expect(api.rpc).toHaveBeenCalledOnce()
})
it('reassignment warns about mismatched dates and explicitly confirms without changing dates',async()=>{
 mount();fireEvent.change(screen.getByLabelText('Winery Visit'),{target:{value:'old'}});const ack=screen.getByRole('checkbox') as HTMLInputElement;expect(ack.required).toBe(true);expect(ack.parentElement?.textContent).toContain('365 days');fireEvent.click(ack);fireEvent.submit(document.querySelector('form')!);await waitFor(()=>expect(close).toHaveBeenCalled());expect(api.rpc.mock.calls[0][1]).toMatchObject({p_confirm_relationship:true,p_fields:{winery_visit_id:'old',acquisition_date:'2026-08-01'}})
})
it('gift correction edits recipient/date/notes through the correction RPC only',async()=>{
 render(<HistoryCorrection kind="gift" record={{id:'gift',giftedTo:'Friend',giftedOn:'2026-08-01'} as GiftRecord} data={data} householdId="h" onCancel={close} onSaved={saved} onNotice={notice}/>);fireEvent.change(screen.getByLabelText('Gifted to'),{target:{value:'Family'}});fireEvent.change(screen.getByLabelText('Gift date'),{target:{value:'2026-08-02'}});fireEvent.submit(document.querySelector('form')!);await waitFor(()=>expect(close).toHaveBeenCalled());expect(api.rpc).toHaveBeenCalledWith('correct_history_record',expect.objectContaining({p_kind:'gift',p_fields:{gifted_to:'Family',gifted_on:'2026-08-02',occasion_note:null}}))
})
it('matches use date and winery, separate unknown dates and conflicting trips',()=>{
 expect(purchaseMatch(data,data.visits[0],purchase)).toMatchObject({likely:true,warning:null});expect(purchaseMatch(data,data.visits[1],purchase)).toMatchObject({likely:false,days:365});expect(purchaseMatch(data,data.visits[0],{...purchase,acquisitionDate:null}).warning).toContain('no date');expect(purchaseMatch({...data,travelReferences:[{wineryVisitId:'v',externalId:'a'},{purchaseId:'p',externalId:'b'}] as CellarData['travelReferences']},data.visits[0],purchase).warning).toContain('different trip')
})
it('contact links use manual values first and only accepted fallback; dates and values are readable',()=>{
 const winery={...data.wineries[0],websiteUrl:'https://manual.example',contactPhone:'123',address:'1 Main',city:'Geneva'};const contact=wineryContact(winery,{...data,wineryOnlineInfo:[{entityId:'w',acceptedData:{website_url:'https://source.example',email:'info@example.com'}}] as unknown as CellarData['wineryOnlineInfo']});expect(contact.websiteUrl).toBe('https://manual.example/');expect(contact.email).toBe('info@example.com');expect(contact.mapUrl).toContain('1%20Main');expect(wineryContact({...winery,websiteUrl:'javascript:alert(1)'},data).websiteUrl).toBe('');expect(displayValue('cork')).toBe('Cork');expect(displayValue('yes')).toBe('Yes');expect(displayDate('2026-08-01')).toBe('Aug 1, 2026')
})
it('sorting is stable and does not mutate loaded collection order',()=>{
 const wines=[{id:'a',name:'Zed',vintage:2020,createdAt:'2026-08-01'},{id:'b',name:'Alpha',vintage:2024,createdAt:'2025-08-01'}] as CellarData['wines'];expect(sortWines(wines,'name')[0].id).toBe('b');expect(sortWines(wines,'recent')[0].id).toBe('a');expect(sortWines(wines,'vintage')[0].id).toBe('b');expect(wines[0].id).toBe('a')
})
it('failed photo requests recovery, then displays renewed URL without changing card click behavior',()=>{
 const recovery=vi.fn(),open=vi.fn();window.addEventListener('cellar-photo-error',recovery);const view=render(<button onClick={open}><PhotoImage src="expired" alt="Wine"/></button>);fireEvent.error(screen.getByRole('img'));expect(recovery).toHaveBeenCalledOnce();fireEvent.click(screen.getByText('Photo unavailable'));expect(open).toHaveBeenCalledOnce();view.rerender(<button onClick={open}><PhotoImage src="renewed" alt="Wine"/></button>);expect((screen.getByRole('img') as HTMLImageElement).src).toContain('renewed');window.removeEventListener('cellar-photo-error',recovery)
})
it('large supported photos resize without enlargement and fall back safely if decode fails',async()=>{
 const file=new File([new Uint8Array(3*1024*1024)],'label.jpg',{type:'image/jpeg'}),closeBitmap=vi.fn(),draw=vi.fn();vi.stubGlobal('createImageBitmap',vi.fn().mockResolvedValue({width:4000,height:3000,close:closeBitmap}));vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue({fillRect:vi.fn(),drawImage:draw} as unknown as CanvasRenderingContext2D);vi.spyOn(HTMLCanvasElement.prototype,'toBlob').mockImplementation(callback=>callback(new Blob(['small'],{type:'image/jpeg'})));const result=await optimizePhoto(file);expect(result.size).toBeLessThan(file.size);expect(draw.mock.calls[0].slice(1)).toEqual([0,0,2560,1920]);expect(closeBitmap).toHaveBeenCalledOnce();vi.stubGlobal('createImageBitmap',vi.fn().mockRejectedValue(new Error('decode')));expect(await optimizePhoto(file)).toBe(file);const heic=new File([file],'camera.heic',{type:'image/heic'});expect(await optimizePhoto(heic)).toBe(heic)
})

it('photo selection previews the chosen file and releases temporary URLs',()=>{
 const revoke=vi.fn();Object.defineProperty(URL,'createObjectURL',{configurable:true,value:vi.fn().mockReturnValue('blob:preview')});Object.defineProperty(URL,'revokeObjectURL',{configurable:true,value:revoke});const view=render(<PhotoPicker label="Add photo"/>);const input=document.querySelector('input')!;expect(input.accept).toBe('image/*');expect(input.hasAttribute('capture')).toBe(false);fireEvent.change(input,{target:{files:[new File(['photo'],'photo.jpg',{type:'image/jpeg'})]}});expect((screen.getByAltText('Selected photo preview') as HTMLImageElement).src).toBe('blob:preview');view.unmount();expect(revoke).toHaveBeenCalledWith('blob:preview')
})
