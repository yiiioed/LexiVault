import test from 'node:test';
import assert from 'node:assert/strict';
import {domEnv} from './dom-env.mjs';
import {mountExplorer} from '../src/explorer.js';
import {openFileStore} from '../src/plans/file-store.js';
import {openStore} from '../src/plans/store.js';
import {newPlan} from '../src/plans/model.js';
const dom=domEnv('<div id="files"></div>');globalThis.Option=dom.window.Option;
const entries=[{path:'课题',name:'课题',kind:'folder'}],calls=[],opened=[];let allowed=true;
const client={directory:'',async request(path,options={}){
 calls.push({path,options});
 if(options.method==='POST'){const p=JSON.parse(options.body);if(path.endsWith('/delete')){const index=entries.findIndex(e=>e.path===p.path);if(index>=0)entries.splice(index,1);return {path:p.path,destination:'system_trash'};}const relative=[p.parent,p.name].filter(Boolean).join('/');entries.push({path:relative,name:p.name,kind:p.kind,plan_id:'p1'});return {path:relative};}
 return {entries:structuredClone(entries),warnings:[]};
}};
const explorer=mountExplorer(document.getElementById('files'),{client,space:{id:'files',name:'我的工作空间'},beforeChange:async()=>allowed,onOpen:e=>opened.push(e)});
const settle=()=>new Promise(resolve=>setTimeout(resolve,20));
const button=label=>[...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')===label);
test.after(()=>{explorer.destroy();dom.window.close();});
test('file tree creates in selected directory before opening',async()=>{
 await settle();button('课题').click();assert.equal(client.directory,'课题');button('新建笔记').click();
 document.querySelector('dialog input').value='我的计划.md';button('创建').click();await settle();
 const body=JSON.parse(calls.find(c=>c.options.method==='POST').options.body);
 assert.equal(body.parent,'课题');assert.equal(opened[0].path,'课题/我的计划.md');assert.equal(opened[0].plan_id,'p1');
 assert.match(document.getElementById('files').textContent,/我的工作空间/);
});
test('unsaved draft blocks filesystem writes',async()=>{
 allowed=false;const count=calls.filter(c=>c.options.method==='POST').length;button('新建文件夹').click();document.querySelector('dialog input').value='不能创建';button('创建').click();await settle();
 assert.equal(calls.filter(c=>c.options.method==='POST').length,count);assert.ok(document.querySelector('dialog').open);document.querySelector('dialog').close();allowed=true;
});
test('refresh discovers external files and resets deleted selected folder',async()=>{
 entries.push({path:'课题/外部.md',name:'外部.md',kind:'markdown',plan_id:'external'});await explorer.refresh();assert.ok(button('外部.md'));
 entries.splice(0,entries.length);await explorer.refresh();assert.equal(client.directory,'');assert.match(document.getElementById('files').textContent,/文件夹为空/);
});
test('explorer removes its own recycle bin and deletes through the system-bin endpoint',async()=>{
 assert.equal(button('回收站'),undefined);entries.push({path:'删除测试.md',name:'删除测试.md',kind:'markdown',plan_id:'delete'});await explorer.refresh();
 let confirmed=0;dom.window.confirm=()=>{confirmed++;return false;};button('操作 删除测试.md').click();button('删除').click();await settle();
 assert.ok(entries.some(e=>e.path==='删除测试.md'));
 dom.window.confirm=()=>{confirmed++;return true;};button('删除').click();await settle();
 assert.equal(confirmed,2);assert.equal(entries.some(e=>e.path==='删除测试.md'),false);
 assert.ok(calls.some(c=>c.path.endsWith('/files/delete')));assert.equal(calls.some(c=>c.path.includes('/trash')),false);
});

test('fresh filesystem workspaces never resurrect browser plans',async()=>{
 const space={id:'fresh-layout',name:'空白',layout:'files',schema_version:5};const legacy=await openStore('lexivault.plans.workspace.'+space.id);await legacy.putPlan(newPlan('旧内容'),0);legacy.close();
 const writes=[];const store=await openFileStore({directory:'',request:async(path,options={})=>{if(options.method)writes.push(path);return path.includes('/preferences/')?{value:null}:{plans:[],warnings:[]};}},space,()=>({type:'doc',content:[{type:'paragraph'}]}));
 assert.equal(store.migrationCount,0);assert.deepEqual(writes,[]);assert.deepEqual(await store.allPlans(),[]);store.close();
});
