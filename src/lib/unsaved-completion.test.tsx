// @vitest-environment jsdom
import {useRef} from 'react'
import {afterEach,expect,it,vi} from 'vitest'
import {cleanup,fireEvent,render} from '@testing-library/react'
import {confirmAbandon,markFormSaved,useFormGuard} from './unsaved-changes'
import {finishSuccessfulAction} from './interaction'
afterEach(()=>{cleanup();vi.restoreAllMocks()})
function Form({busy=false}:{busy?:boolean}){
 const ref=useRef<HTMLDivElement>(null);useFormGuard(ref,60,busy)
 return <div ref={ref}><form aria-busy={busy}><input name="recipient" defaultValue=""/><select name="lot"><option value="first">First bottle</option><option value="second">Second bottle</option></select></form></div>
}
it.each([false,true])('saved form can finish while busy, even after refresh changes its inventory choices (refresh fails: %s)',async(fails)=>{
 const confirm=vi.spyOn(window,'confirm').mockReturnValue(false)
 const {container,rerender}=render(<Form/>);const form=container.querySelector('form')!
 fireEvent.change(form.querySelector('input')!,{target:{value:'Friend'}});rerender(<Form busy/>);
 expect(confirmAbandon()).toBe(false)
 const finish=vi.fn(()=>expect(confirmAbandon()).toBe(true));const notice=vi.fn()
 await finishSuccessfulAction({form,refresh:async()=>{form.querySelector('option')!.remove();if(fails)throw Error('offline')},finish,notice,message:'Gift saved.'})
 expect(finish).toHaveBeenCalledOnce();expect(confirm).not.toHaveBeenCalled()
})
it('a subsequent real edit becomes dirty again after a successful save',()=>{
 vi.spyOn(window,'confirm').mockReturnValue(false)
 const {container}=render(<Form/>);const form=container.querySelector('form')!;const input=form.querySelector('input')!
 fireEvent.change(input,{target:{value:'Friend'}});markFormSaved(form);expect(confirmAbandon()).toBe(true)
 fireEvent.change(input,{target:{value:'Another friend'}});expect(confirmAbandon()).toBe(false);expect(window.confirm).toHaveBeenCalledOnce()
})
