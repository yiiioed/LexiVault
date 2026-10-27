import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { domEnv } from './dom-env.mjs';
import { initDiscovery } from '../src/discover/app.js';
import { initialState, STORAGE_KEY } from '../src/discover/model.js';
import { EXAMPLE_PAPERS } from '../src/discover/catalog.js';
import { PAPER_FIXTURES } from './discovery-fixtures.mjs';
EXAMPLE_PAPERS.push(...PAPER_FIXTURES);
const html=await readFile(new URL('../dist/discover.html',import.meta.url),'utf8');
function setup(t,saved={}){
 const dom=domEnv(html,'https://example.test/discover.html'),w=dom.window,d=w.document,q=s=>d.querySelector(s),click=s=>q(s).click();
 const initial=initialState();initial.queue=['molecular-review','self-supervised-graph'];initial.filters.query='graph neural networks molecular pretraining';
 w.localStorage.setItem(STORAGE_KEY+'.unselected',JSON.stringify(initial));
 for(const [k,v]of Object.entries(saved))w.localStorage.setItem(k.replace(STORAGE_KEY,STORAGE_KEY+'.unselected'),v);
 let requests=0;w.fetch=()=>{requests++;throw Error('Unexpected network request');};w.XMLHttpRequest=function(){requests++;throw Error('Unexpected network request');};
 const api=initDiscovery(),input=(s,value,type='input')=>{q(s).value=value;q(s).dispatchEvent(new w.Event(type,{bubbles:true}));},submit=s=>q(s).dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
 t.after(()=>{assert.equal(requests,0);api.destroy();w.close();});return {w,d,q,click,input,submit,api};
}
test('discovery is real HTML matching the three work areas with a explicitly supplied test results',t=>{
 const u=setup(t);assert.equal(u.d.querySelectorAll('.lv-nav-link').length,6);assert.equal(u.q('.prototype-design'),null);assert.ok(u.q('.d-filters'));assert.ok(u.q('.d-results'));assert.ok(u.q('.d-queue'));assert.equal(u.d.querySelectorAll('[data-source-enable]').length,5);assert.equal(u.d.querySelectorAll('.d-paper').length,5);assert.equal(u.q('.s-topbar'),null);assert.equal(u.q('.d-sourcebar'),null);assert.equal(u.q('.d-demo-notice'),null);assert.ok(u.q('.d-toolbar #nav-open'));assert.ok(u.q('#source-config-dialog [data-source-enable]'));assert.match(u.q('.d-results-footnote').textContent,/检索/);assert.equal(u.q('#acquisition-dialog').open,false);assert.ok(u.q('.d-filters #source-settings'));assert.equal(u.q('#download-settings'),null);assert.equal(u.q('.d-sourcebar #source-settings'),null);assert.equal(u.d.querySelectorAll('#acquisition-fix-path').length,1);assert.doesNotMatch(u.q('.d-filters').textContent,/入库位置\s*$/);
});
test('source tabs support arrow keys, show only appropriate fields and keep cancelled edits out',t=>{
 const u=setup(t);u.click('#source-settings');u.click('#provider-tab-crossref');u.input('#source-mode-crossref','polite','change');
 assert.equal(u.q('[data-field-wrapper="crossref.email"]').hidden,false);assert.equal(u.q('[data-field-wrapper="crossref.key"]').hidden,true);assert.equal(u.q('#source-crossref-email').required,true);
 u.q('#provider-tab-crossref').dispatchEvent(new u.w.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));assert.equal(u.q('#provider-tab-arxiv').getAttribute('aria-selected'),'true');assert.equal(u.q('#provider-panel-arxiv').hidden,false);assert.match(u.q('#provider-panel-arxiv').textContent,/无需填写 Key/);
 u.q('#source-config-dialog').close();u.click('#source-settings');assert.equal(u.q('#source-mode-crossref').value,'public');
});
test('source choices stay in the configuration dialog and apply together without keeping cancelled changes',t=>{
 const u=setup(t);u.click('#source-settings');u.click('#source-enable-openalex');assert.match(u.q('#source-selection-count').textContent,/4/);assert.equal(u.api.snapshot().sources.includes('openalex'),false);
 u.q('#source-config-dialog').close();u.click('#source-settings');assert.equal(u.q('#source-enable-openalex').checked,false);
 u.click('#source-enable-openalex');u.submit('#source-config-form');assert.equal(u.api.snapshot().sources.includes('openalex'),true);assert.equal(u.d.querySelectorAll('.d-paper').length,6);assert.match(u.q('#source-settings-status').textContent,/4/);
});
test('year histogram shows real counts on hover and supports keyboard navigation and a single-year selection',t=>{
 const u=setup(t),bar=u.q('[data-year-bin="2024"]');bar.dispatchEvent(new u.w.MouseEvent('pointerover',{bubbles:true}));
 assert.equal(u.q('#discovery-year-tooltip').hidden,false);assert.equal(u.q('#discovery-year-tooltip-year').textContent,'2024');assert.match(u.q('#discovery-year-tooltip-count').textContent,/1 篇/);
 u.q('#discovery-year-chart').dispatchEvent(new u.w.Event('pointerleave'));assert.equal(u.q('#discovery-year-tooltip').hidden,true);
 bar.focus();bar.dispatchEvent(new u.w.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}));assert.equal(u.d.activeElement.dataset.yearBin,'2025');assert.equal(u.q('#discovery-year-tooltip-year').textContent,'2025');
 u.click('[data-year-bin="2023"]');assert.deepEqual([u.api.snapshot().filters.from,u.api.snapshot().filters.to],[2023,2023]);assert.equal(u.d.querySelectorAll('.d-paper').length,1);assert.equal(u.api.snapshot().queue.length,2);
 u.click('#reset-discovery-filters');assert.equal(u.q('#discovery-year-slider-from').value,'2021');assert.equal(u.q('#discovery-year-slider-to').value,'2026');
});
test('year handles preview immediately, commit on release and clamp instead of crossing',t=>{
 const u=setup(t);u.input('#discovery-year-slider-from','2023');assert.equal(u.q('#discovery-year-label-from').textContent,'2023');assert.equal(u.q('[data-year-bin="2021"]').classList.contains('is-in-range'),false);assert.equal(u.api.snapshot().filters.from,2021);
 u.input('#discovery-year-slider-from','2023','change');assert.equal(u.api.snapshot().filters.from,2023);assert.equal(u.d.querySelectorAll('.d-paper').length,3);
 u.input('#discovery-year-slider-to','2024','change');assert.equal(u.d.querySelectorAll('.d-paper').length,2);
 u.input('#discovery-year-slider-to','2021','change');assert.deepEqual([u.api.snapshot().filters.from,u.api.snapshot().filters.to],[2023,2023]);assert.equal(u.q('#discovery-year-slider-to').value,'2023');
 u.input('#discovery-year-slider-from','2026','change');assert.equal(u.api.snapshot().filters.from,2023);
 assert.equal(JSON.parse(u.w.localStorage.getItem(STORAGE_KEY+'.unselected')).filters.from,2023);
});
test('clicking and dragging the year rail uses one stable scale and pointer cancellation restores the range',t=>{
 const u=setup(t),slider=u.q('#discovery-year-slider');slider.getBoundingClientRect=()=>({left:100,width:216});
 const pointer=(type,x)=>{const e=new u.w.MouseEvent(type,{bubbles:true,cancelable:true,clientX:x,button:0});Object.defineProperty(e,'pointerId',{value:1});slider.dispatchEvent(e);};
 pointer('pointerdown',188);assert.equal(u.q('#discovery-year-label-from').textContent,'2023');pointer('pointermove',228);pointer('pointerup',228);
 assert.deepEqual([u.api.snapshot().filters.from,u.api.snapshot().filters.to],[2024,2026]);assert.equal(u.q('#discovery-year-slider-from').min,'2021');assert.equal(u.d.querySelectorAll('.d-paper').length,2);
 pointer('pointerdown',268);assert.equal(u.q('#discovery-year-label-to').textContent,'2025');pointer('pointercancel',268);
 assert.equal(u.q('#discovery-year-label-to').textContent,'2026');assert.equal(u.q('#discovery-year-to').value,'2026');assert.equal(u.api.snapshot().filters.to,2026);
});
test('precise year inputs expand the histogram scale and report invalid values beside the control',t=>{
 const u=setup(t);u.input('#discovery-year-from','2002','change');assert.equal(u.d.querySelectorAll('[data-year-bin]').length,25);assert.equal(u.q('#discovery-year-slider-from').min,'2002');assert.equal(u.q('[data-year-bin="2010"]').dataset.yearCount,'0');
 u.input('#discovery-year-slider-from','2022','change');assert.equal(u.q('#discovery-year-slider-from').min,'2002');assert.equal(u.api.snapshot().filters.from,2022);
 u.input('#discovery-year-from','2027','change');assert.equal(u.q('#discovery-year-error').hidden,false);assert.equal(u.q('#discovery-year-precision').open,true);assert.equal(u.api.snapshot().filters.from,2022);
 u.click('#reset-discovery-filters');assert.equal(u.q('#discovery-year-error').hidden,true);assert.equal(u.q('#discovery-year-slider-from').min,'2021');
});
test('credential mode blocks missing keys and stores only access mode, not secrets or contact email',t=>{
 const u=setup(t);u.click('#source-settings');u.input('#source-mode-semantic','key','change');u.submit('#source-config-form');assert.equal(u.q('#source-config-dialog').open,true);assert.match(u.q('#source-config-error').textContent,/API Key/);
 u.input('#source-semantic-key','TOP-SECRET-S2');u.click('#provider-tab-crossref');u.input('#source-mode-crossref','polite','change');u.input('#source-crossref-email','user@example.edu');u.submit('#source-config-form');
 assert.equal(u.q('#source-config-dialog').open,false);assert.equal(u.api.snapshot().modes.semantic,'key');assert.doesNotMatch(u.w.localStorage.getItem(STORAGE_KEY+'.unselected'),/TOP-SECRET|user@example.edu/);assert.equal(u.q('#source-semantic-key').value,'');
 u.click('#source-settings');assert.equal(u.q('#source-semantic-key').value,'TOP-SECRET-S2');u.click('#provider-tab-semantic');u.click('[data-reveal-key="source-semantic-key"]');assert.equal(u.q('#source-semantic-key').type,'text');u.q('#source-config-dialog').close();assert.equal(u.q('#source-semantic-key').type,'password');assert.equal(u.q('#source-semantic-key').value,'');
});
test('OpenAlex basic access stays optional and cursor access requires its own key',t=>{
 const u=setup(t);u.click('#source-settings');u.click('#source-enable-openalex');u.click('#provider-tab-openalex');assert.equal(u.q('#source-openalex-key').required,false);u.input('#source-mode-openalex','cursor','change');assert.equal(u.q('#source-openalex-key').required,true);u.submit('#source-config-form');assert.match(u.q('#source-config-error').textContent,/OpenAlex/);u.input('#source-openalex-key','MY-OPENALEX-KEY');u.submit('#source-config-form');assert.equal(u.q('#source-config-dialog').open,false);
});
test('download config validates the path and previews directory and filename choices',t=>{
 const u=setup(t);u.click('#confirm-acquisition');u.click('#acquisition-fix-path');u.submit('#download-config-form');assert.match(u.q('#download-config-error').textContent,/路径/);u.input('#download-path','https://somewhere/papers');u.submit('#download-config-form');assert.equal(u.q('#download-config-dialog').open,true);
 u.input('#download-platform','linux','change');u.input('#download-path','/home/me/research');u.input('#download-layout','year','change');assert.match(u.q('#download-preview').textContent,/\/2025\/论文标题_2025.pdf/);u.submit('#download-config-form');assert.equal(u.api.snapshot().download.path,'/home/me/research');assert.equal(u.q('#acquisition-download-path').textContent,'/home/me/research');assert.equal(u.q('#download-config-dialog').open,false);
});
test('search filters actual examples, sorts them and reports an honest empty state',t=>{
 const u=setup(t);u.input('#discovery-query','no-such-paper');u.submit('#discovery-search-form');assert.equal(u.d.querySelectorAll('.d-paper').length,0);assert.match(u.q('#discovery-results').textContent,/检索结果/);u.click('#reset-discovery-filters');assert.equal(u.d.querySelectorAll('.d-paper').length,5);
 u.input('#discovery-sort','oldest','change');assert.equal(u.q('.d-paper').dataset.resultId,'evaluation-graph');u.input('#discovery-year-from','2026','change');u.input('#discovery-year-to','2024','change');assert.equal(u.q('#discovery-year-from').getAttribute('aria-invalid'),'true');assert.match(u.q('#discovery-status').textContent,/结束年份/);
});
test('queue toggles and removals are unique and empty queue disables confirmation',t=>{
 const u=setup(t);u.click('[data-toggle-paper="molecular-contrast"]');assert.equal(u.api.snapshot().queue.length,3);u.click('[data-toggle-paper="molecular-contrast"]');assert.equal(u.api.snapshot().queue.length,2);
 u.click('[data-remove-paper="molecular-review"]');u.click('[data-remove-paper="self-supervised-graph"]');assert.equal(u.q('#confirm-acquisition').disabled,true);assert.match(u.q('#discovery-queue').textContent,/留一个位置/);
});
test('paging retains queued papers and resets to page one after filters or page size changes',t=>{
 const u=setup(t);u.click('#source-settings');u.click('#source-enable-openalex');u.submit('#source-config-form');u.input('#discovery-page-size','5','change');
 assert.equal(u.d.querySelectorAll('.d-paper').length,5);assert.match(u.q('#discovery-page-range').textContent,/1–5 \/ 6/);
 u.q('#discovery-results').scrollTop=170;u.click('.d-page-next');
 assert.equal(u.d.querySelectorAll('.d-paper').length,1);assert.equal(u.q('.d-paper').dataset.resultId,'evaluation-graph');assert.equal(u.q('#discovery-results').scrollTop,0);assert.equal(u.q('.d-page-next').disabled,true);
 u.click('[data-toggle-paper="evaluation-graph"]');assert.ok(u.api.snapshot().queue.includes('evaluation-graph'));assert.equal(u.q('#discovery-pagination [aria-current="page"]').textContent,'2');
 u.click('.d-page-prev');assert.equal(u.q('.d-page-prev').disabled,true);assert.ok(u.api.snapshot().queue.includes('evaluation-graph'));
 u.click('.d-page-next');u.q('#filter-open-access').checked=true;u.q('#filter-open-access').dispatchEvent(new u.w.Event('change',{bubbles:true}));
 assert.equal(u.q('#discovery-pagination [aria-current="page"]').textContent,'1');assert.ok(u.api.snapshot().queue.includes('evaluation-graph'));assert.equal(u.d.querySelectorAll('.d-paper').length,4);
 u.input('#discovery-page-size','20','change');assert.equal(JSON.parse(u.w.localStorage.getItem(STORAGE_KEY+'.unselected')).pageSize,20);
 u.input('#discovery-query','no-result');u.submit('#discovery-search-form');assert.match(u.q('#discovery-page-range').textContent,/0–0 \/ 0/);assert.equal(u.q('.d-page-next').disabled,true);
});
test('adding a paper preserves its expanded abstract and the results scroll position',t=>{
 const u=setup(t);u.q('.d-paper details').open=true;u.q('#discovery-results').scrollTop=120;
 u.click('[data-toggle-paper="molecular-contrast"]');assert.equal(u.q('.d-paper details').open,true);assert.equal(u.q('#discovery-results').scrollTop,120);
});
test('compact work area switches panes and search returns to the results pane',t=>{
 const u=setup(t);u.click('[data-workspace-tab="filters"]');assert.equal(u.q('.d-workspace').dataset.activePanel,'filters');assert.equal(u.q('[data-workspace-tab="filters"]').getAttribute('aria-pressed'),'true');
 u.click('[data-workspace-tab="queue"]');assert.equal(u.q('.d-workspace').dataset.activePanel,'queue');assert.equal(u.q('#queue-tab-count').textContent,u.q('#queue-count').textContent);
 u.submit('#discovery-search-form');assert.equal(u.q('.d-workspace').dataset.activePanel,'results');assert.equal(u.q('[data-workspace-tab="results"]').getAttribute('aria-pressed'),'true');
});
test('confirmation opens the vault picker and preserves a custom destination through path configuration',t=>{
 const u=setup(t);u.click('#confirm-acquisition');assert.equal(u.q('#acquisition-dialog').open,true);u.input('#destination-vault','custom','change');u.input('#destination-name','我的课题');u.click('#destination-custom');u.input('#destination-folder-name','2026/第一轮精读');u.submit('#acquisition-form');assert.match(u.q('#acquisition-error').textContent,/下载路径/);
 u.click('#acquisition-fix-path');assert.equal(u.q('#acquisition-dialog').open,false);u.input('#download-path','D:\\Research\\LexiVault');u.submit('#download-config-form');assert.equal(u.q('#acquisition-dialog').open,true);assert.equal(u.q('#destination-name').value,'我的课题');assert.match(u.q('#destination-preview').textContent,/第一轮精读/);
 u.submit('#acquisition-form');assert.equal(u.q('#acquisition-dialog').open,false);assert.deepEqual(u.api.lastDraft.destination,{vaultName:'我的课题',folder:'2026/第一轮精读'});assert.equal(u.api.lastDraft.execution,'not-connected');assert.equal(u.api.lastDraft.exampleData,true);assert.match(u.q('#discovery-draft-summary').textContent,/未执行下载或入库/);assert.ok(u.w.localStorage.getItem(STORAGE_KEY+'.unselected.draft'));
});
test('refresh restores nonsecret preferences and drafts while correctly asking for expired page-only keys',t=>{
 const first=setup(t);first.click('#source-settings');first.input('#source-mode-semantic','key','change');first.input('#source-semantic-key','DO-NOT-PERSIST');first.submit('#source-config-form');
 const next=setup(t,{[STORAGE_KEY]:first.w.localStorage.getItem(STORAGE_KEY+'.unselected')});assert.equal(next.api.snapshot().modes.semantic,'key');assert.match(next.q('#source-settings').textContent,/待填/);next.click('#source-settings');assert.equal(next.q('#source-semantic-key').value,'');
});
test('a saved acquisition uses selected access modes but its persisted and exported JSON omit all secrets',async t=>{
 const u=setup(t);u.click('#source-settings');u.input('#source-mode-semantic','key','change');u.input('#source-semantic-key','SECRET-S2-123');u.input('#source-mode-crossref','plus','change');u.submit('#source-config-form');assert.match(u.q('#source-config-error').textContent,/Token/);u.input('#source-crossref-key','SECRET-CROSSREF-456');u.submit('#source-config-form');
 u.click('[data-toggle-paper="molecular-contrast"]');u.click('#confirm-acquisition');u.click('#acquisition-fix-path');u.input('#download-path','./downloads');u.submit('#download-config-form');u.submit('#acquisition-form');
 const serialized=u.w.localStorage.getItem(STORAGE_KEY+'.unselected.draft');assert.doesNotMatch(serialized,/SECRET-|api_key|Token/);assert.equal(u.api.lastDraft.sources.find(p=>p.id==='semantic').accessMode,'key');
 let blob;u.w.URL.createObjectURL=value=>{blob=value;return 'blob:example';};u.w.URL.revokeObjectURL=()=>{};u.w.HTMLAnchorElement.prototype.click=function(){};u.click('#export-acquisition-draft');
 const exported=await new Promise((resolve,reject)=>{const reader=new u.w.FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsText(blob);});assert.doesNotMatch(exported,/SECRET-|api_key|Token/);assert.equal(JSON.parse(exported).credentialsIncluded,false);
 const next=setup(t,{[STORAGE_KEY]:u.w.localStorage.getItem(STORAGE_KEY+'.unselected'),[STORAGE_KEY+'.draft']:serialized});assert.deepEqual(next.api.lastDraft.destination,u.api.lastDraft.destination);assert.equal(next.q('#discovery-draft-summary').hidden,false);
});
test('storage failures preserve an editable page and exported drafts are explicitly not executed',t=>{
 const u=setup(t);u.w.Storage.prototype.setItem=function(){throw Error('quota');};u.click('#confirm-acquisition');u.click('#acquisition-fix-path');u.input('#download-path','./downloads');u.submit('#download-config-form');assert.equal(u.api.snapshot().download.path,'./downloads');assert.match(u.q('#suite-toast').textContent,/本页/);
 u.click('#confirm-acquisition');u.submit('#acquisition-form');assert.ok(u.api.lastDraft);assert.match(u.q('#suite-toast').textContent,/未能保存/);
 let blob,filename;u.w.URL.createObjectURL=value=>{blob=value;return 'blob:example';};u.w.URL.revokeObjectURL=()=>{};u.w.HTMLAnchorElement.prototype.click=function(){filename=this.download;};u.click('#export-acquisition-draft');assert.ok(blob);assert.equal(filename,'LexiVault-acquisition-draft.json');
});
