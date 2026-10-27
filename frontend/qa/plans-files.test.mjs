import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {domEnv} from './dom-env.mjs';
import {openStore} from '../src/plans/store.js';
import {newPlan} from '../src/plans/model.js';

const dom=domEnv(await readFile(new URL('../dist/plans.html',import.meta.url),'utf8'));
const w=dom.window,q=s=>document.querySelector(s),space={id:'file-plan-test',name:'本地课题',path:'D:/Libraries/本地课题'};
const legacy=await openStore('lexivault.plans.workspace.'+space.id);
const original=newPlan('浏览器中的计划',{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'从浏览器迁移的原内容'}]}]});
await legacy.putPlan(original,0);legacy.close();
const remote=new Map(),preferences=new Map(),calls=[];
let failSave=false;
const client={current:space,ready:Promise.resolve(space),async request(path,options={}){
 calls.push({path,options});
 if(path.includes('/preferences/')){const key=decodeURIComponent(path.split('/preferences/')[1]);if(options.method==='PUT')preferences.set(key,JSON.parse(options.body).value);return {value:preferences.get(key)??null};}
 if(path.endsWith('/files'))return [];
 if(options.method==='POST'){
  if(failSave)throw Object.assign(new Error('磁盘不可写，未覆盖原文件'),{status:500});
  const manifest=JSON.parse(options.body.get('manifest')),result=[];
  for(const item of manifest.plans){
   const previous=remote.get(item.plan.id);
   if((previous?.revision || 0)!==item.expected_revision || previous?.missing)throw Object.assign(new Error('本地文件已被修改或删除'),{status:409});
   const saved={...structuredClone(item.plan),revision:item.expected_revision+1,local_path:space.path+'/plans/'+item.plan.id+'.md',missing:false,external_error:''};
   delete saved.external_markdown;remote.set(saved.id,saved);result.push(structuredClone(saved));
  }
  return result;
 }
 return {plans:structuredClone([...remote.values()]),warnings:[]};
}};
w.LexiVaultSpace=client;
const {plansReady}=await import('../src/plans/app.js');const api=await plansReady;
test.after(()=>{api.destroy();dom.window.close();});

test('same-workspace browser plans migrate once and preserve their original browser records',async()=>{
 assert.equal(api.store.kind,'files');assert.equal(remote.size,1);assert.equal(api.current.id,original.id);
 assert.match(q('#save-indicator').textContent,/已保存到本地/);assert.match(q('#plan-local-path').textContent,/Libraries/);
 const originalDb=await openStore('lexivault.plans.workspace.'+space.id);
 assert.equal((await originalDb.getPlan(original.id)).title,'浏览器中的计划');originalDb.close();
 assert.ok([...preferences.keys()].some(key=>key.startsWith('browser-import:')));
 assert.equal(api.store.migrationCount,1);
});

test('editing the plan writes multipart content to the local service and clears its emergency draft only after success',async()=>{
 q('#plan-title').value='我保存到本地的计划';q('#plan-title').dispatchEvent(new Event('input',{bubbles:true}));
 api.editor.commands.insertContent('页面新增内容');
 assert.ok(localStorage.getItem('lexivault.plan-draft.'+space.id+'.'+api.current.id));
 await api.save();assert.equal(remote.get(api.current.id).title,'我保存到本地的计划');
 const write=calls.filter(c=>c.options.method==='POST').at(-1),manifest=JSON.parse(write.options.body.get('manifest'));
 assert.match(manifest.plans[0].markdown,/页面新增内容/);assert.equal(localStorage.getItem('lexivault.plan-draft.'+space.id+'.'+api.current.id),null);
});

test('rich text, nested lists and code survive a subsequent external Markdown edit',async()=>{
 const doc={type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'星号 * 下划线 _ 与 <标签>',marks:[{type:'underline'}]}]},{type:'bulletList',content:[{type:'listItem',content:[{type:'paragraph',content:[{type:'text',text:'外层'}]},{type:'bulletList',content:[{type:'listItem',content:[{type:'paragraph',content:[{type:'text',text:'内层'}]}]}]}]}]},{type:'codeBlock',content:[{type:'text',text:'const x = `hello`; **raw**'}]}]};
 api.editor.commands.setContent(doc,{emitUpdate:true});await api.save();
 const write=calls.filter(c=>c.options.method==='POST').at(-1),body=JSON.parse(write.options.body.get('manifest')).plans[0].markdown.replace(/^# [^\n]*\n\n/,'');
 const disk=remote.get(api.current.id);disk.external_markdown=body+'\n外部追加的文字\n';disk.revision++;
 await api.sync();const text=api.editor.getText();assert.match(text,/星号 \* 下划线 _ 与 <标签>/);assert.match(text,/const x = `hello`; \*\*raw\*\*/);assert.match(text,/内层/);assert.match(text,/外部追加/);assert.ok(q('#plan-editor u'));
});

test('external Markdown edits refresh a clean editor safely without writing back over the file',async()=>{
 const disk=remote.get(api.current.id);disk.revision++;disk.external_markdown='## 外部小标题\n\n外部编辑后的正文\n\n<script>bad()</script>\n';
 const writes=calls.filter(c=>c.options.method==='POST').length;
 await api.sync();assert.match(api.editor.getText(),/外部编辑后的正文/);assert.equal(q('#plan-editor script'),null);
 assert.equal(calls.filter(c=>c.options.method==='POST').length,writes);
 assert.match(q('#save-indicator').textContent,/载入外部修改/);
});

test('an external edit never replaces a dirty browser draft and requires explicit conflict resolution',async()=>{
 api.editor.commands.insertContent('页面尚未保存的草稿');
 const disk=remote.get(api.current.id);disk.revision++;disk.external_markdown='外部同时修改的内容\n';
 await api.sync();assert.match(api.editor.getText(),/页面尚未保存的草稿/);
 assert.equal(q('#save-error').hidden,false);assert.match(q('#save-error-text').textContent,/外部修改|外部修改|外部修改|外部/);
 await assert.rejects(api.save(),/冲突/);
 assert.match(localStorage.getItem('lexivault.plan-draft.'+space.id+'.'+api.current.id),/页面尚未保存的草稿/);
 q('#reload-plan').click();await new Promise(resolve=>setTimeout(resolve,35));
 assert.match(api.editor.getText(),/外部同时修改的内容/);assert.doesNotMatch(api.editor.getText(),/页面尚未保存的草稿/);
});

test('a failed disk save retains both the draft and the older persisted plan',async()=>{
 const before=JSON.stringify(remote.get(api.current.id));failSave=true;
 api.editor.commands.insertContent('磁盘失败时保留的内容');await assert.rejects(api.save(),/磁盘不可写/);
 assert.equal(JSON.stringify(remote.get(api.current.id)),before);
 assert.match(localStorage.getItem('lexivault.plan-draft.'+space.id+'.'+api.current.id),/磁盘失败时保留/);
 failSave=false;await api.save();assert.match(JSON.stringify(remote.get(api.current.id)),/磁盘失败时保留/);
});

test('deleting a local file does not silently recreate it and a saved copy gets a new identity',async()=>{
 const missing=remote.get(api.current.id);const oldId=missing.id;missing.missing=true;missing.revision++;
 await api.sync();assert.equal(api.current.missing,true);assert.match(q('#save-indicator').textContent,/文件已删除/);
 api.editor.commands.insertContent('保留并另存的草稿');await assert.rejects(api.save(),/删除/);
 q('#save-copy').click();await new Promise(resolve=>setTimeout(resolve,35));
 assert.notEqual(api.current.id,oldId);assert.equal(api.current.missing,false);assert.ok(remote.get(oldId).missing);
 assert.match(JSON.stringify(remote.get(api.current.id)),/保留并另存的草稿/);
});
