import {JSDOM} from 'jsdom';
import {indexedDB} from 'fake-indexeddb';
export function domEnv(html='<div id="editor"></div>',url='http://127.0.0.1:8000/plans.html'){
 const dom=new JSDOM(html,{url,pretendToBeVisual:true});const w=dom.window;
 for(const k of ['window','document','navigator','DOMParser','HTMLElement','HTMLInputElement','Element','Node','MutationObserver','CustomEvent','Event','KeyboardEvent','FileReader','localStorage','sessionStorage','getComputedStyle','Range'])Object.defineProperty(globalThis,k,{value:k==='window'?w:k==='getComputedStyle'?w.getComputedStyle.bind(w):w[k],configurable:true,writable:true});
 globalThis.indexedDB=indexedDB;globalThis.innerHeight=w.innerHeight;globalThis.innerWidth=w.innerWidth;
 globalThis.requestAnimationFrame=fn=>setTimeout(()=>fn(Date.now()),0);globalThis.cancelAnimationFrame=clearTimeout;globalThis.CSS={escape:s=>String(s).replace(/[^\w-]/g,c=>'\\'+c)};
 w.Range.prototype.getBoundingClientRect=()=>({left:300,right:300,top:200,bottom:220,width:0,height:20});w.Range.prototype.getClientRects=()=>[];
 w.HTMLElement.prototype.scrollIntoView=function(){};w.scrollTo=()=>{};w.scrollBy=()=>{};w.confirm=()=>true;
 w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');this.dispatchEvent(new w.Event('close'));};
 return dom;
}
