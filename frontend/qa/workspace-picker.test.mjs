import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM} from 'jsdom';
const script=fs.readFileSync(new URL('../src/workspace-client.js',import.meta.url),'utf8');
async function setup(t){
 const dom=new JSDOM(fs.readFileSync(new URL('../dist/knowledge.html',import.meta.url),'utf8'),{url:'http://localhost/knowledge.html',runScripts:'outside-only'}),w=dom.window;
 t.after(()=>w.close());w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 const spaces=[{id:'a',name:'当前课题',path:'D:/A'},{id:'b',name:'已有空间 <script>',path:'D:/B'}],calls=[];let current=spaces[0],fail=false;
 w.fetch=async(path,options={})=>{
  calls.push({path,options});let data;
  if(path==='/api/session')data={token:'test-token',data_dir:'D:/Local'};
  else if(path==='/api/workspace/current')data=current;
  else if(path.endsWith('/assistant'))data={state:{conversations:[]}};
  else if(path==='/api/workspaces' && !options.method)data=structuredClone(spaces);
  else if(fail)return {ok:false,status:500,json:async()=>({message:'磁盘不可写'})};
  else if(path.endsWith('/open'))data=current=spaces.find(s=>s.id===path.split('/').at(-2));
  else if(path==='/api/workspaces'){data=current={id:'new',name:JSON.parse(options.body).name,path:'D:/Local/workspaces/new'};spaces.push(data);}
  else throw new Error('Unexpected request '+path);
  return {ok:true,json:async()=>structuredClone(data)};
 };
 w.eval(script);await w.LexiVaultSpace.ready;
 return {w,d:w.document,api:w.LexiVaultSpace,calls,spaces,setFail(value){fail=value;}};
}
test('picker lists registered spaces safely, marks current, and ends with create action',async t=>{
 const {d}=await setup(t);assert.equal(d.querySelectorAll('[data-workspace-id]').length,2);assert.equal(d.querySelector('[data-workspace-id=a]').getAttribute('aria-pressed'),'true');
 assert.equal(d.querySelector('[data-workspace-id=b] script'),null);assert.match(d.querySelector('[data-workspace-id=b]').textContent,/<script>/);
 assert.equal(d.querySelector('#workspace-menu').lastElementChild.id,'new-workspace');assert.equal(d.querySelector('#workspace-menu a'),null);
 d.querySelector('#new-workspace').click();assert.equal(d.querySelector('#sidebar-workspace-dialog').open,true);assert.equal(d.activeElement.id,'sidebar-space-name');assert.match(d.querySelector('#sidebar-space-location').textContent,/D:\/Local/);
});
test('switch waits for page guard before opening space and persists shared selection',async t=>{
 const {api,calls,d,w}=await setup(t);let saved=false;api.addSwitchGuard(async()=>{await Promise.resolve();saved=true;return true;});
 const space=await api.switchTo('b',{navigate:false});assert.ok(saved);assert.equal(space.id,'b');assert.equal(api.current.id,'b');assert.equal(d.querySelector('#workspace-selector [data-workspace-name]').textContent,'已有空间 <script>');
 const open=calls.find(c=>c.path==='/api/workspaces/b/open');assert.equal(open.options.method,'POST');assert.equal(open.options.headers['X-LexiVault-Token'],'test-token');assert.match(w.localStorage.getItem('lexivault.active-workspace.changed'),/:b$/);
 const before=calls.length;await api.switchTo('b',{navigate:false});assert.equal(calls.length,before);
});
test('failed save prevents both switching and creating a workspace',async t=>{
 const {api,calls,d}=await setup(t);const remove=api.addSwitchGuard(()=>false);
 assert.equal(await api.switchTo('b',{navigate:false}),null);assert.equal(await api.create('新课题',{navigate:false}),null);assert.equal(api.current.id,'a');assert.equal(calls.filter(c=>c.options.method==='POST').length,0);assert.match(d.querySelector('#workspace-menu-status').textContent,/尚未处理/);
 remove();assert.equal((await api.switchTo('b',{navigate:false})).id,'b');
});
test('create registers and opens the new workspace, errors preserve original selection',async t=>{
 const ui=await setup(t);ui.setFail(true);await assert.rejects(ui.api.create('新空间',{navigate:false}),/磁盘不可写/);assert.equal(ui.api.current.id,'a');assert.equal(ui.d.querySelector('#new-workspace').disabled,false);
 ui.setFail(false);const space=await ui.api.create(' 新空间 ',{navigate:false});assert.equal(space.name,'新空间');assert.equal(ui.api.current.id,'new');assert.ok(ui.d.querySelector('[data-workspace-id=new]'));assert.equal(ui.d.querySelector('[data-workspace-id=new]').getAttribute('aria-pressed'),'true');
 assert.equal(ui.calls.filter(c=>c.options.method==='POST').at(-1).path,'/api/workspaces');
});
