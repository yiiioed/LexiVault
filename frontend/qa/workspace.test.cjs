const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
const root=path.join(__dirname,'../dist');
const tick=async()=>{await new Promise(setImmediate);await new Promise(setImmediate);};
async function setup(t,{adapter,records=new Map(),spaceId='space-a',unselected=false,failSave=false,saved={}}={}){
  const dom=new JSDOM(fs.readFileSync(path.join(root,'home.html'),'utf8'),{url:'http://localhost/home.html',runScripts:'outside-only',pretendToBeVisual:true});
  const w=dom.window,d=w.document;
  w.matchMedia=()=>({matches:false});
  for(const [key,value]of Object.entries(saved))w.localStorage.setItem(key,value);
  d.querySelectorAll('dialog').forEach(dialog=>{dialog.showModal=()=>dialog.setAttribute('open','');dialog.close=()=>dialog.removeAttribute('open');});
  const docs=[{id:'paper-one',title:'自己的论文',kind:'pdf',source:'local'}];
  const initial={version:1,activeId:null,scope:'vault',modelId:'local',context:[],documents:[],notes:[],conversations:[]};
  if(!records.has(spaceId))records.set(spaceId,{version:0,state:structuredClone(initial)});
  const calls=[];
  w.lexivaultWorkspace=adapter;
  const space=unselected?null:{id:spaceId,name:'我的课题-'+spaceId,path:'D:/Libraries/'+spaceId};
  w.LexiVaultSpace={current:space,ready:Promise.resolve(space),request:async(url,options={})=>{
    calls.push({url,options});
    if(url.endsWith('/documents'))return docs;
    const current=records.get(spaceId);
    if(options.method==='PUT'){
      if(failSave)throw Object.assign(new Error('其他页面已更新对话'),{status:409});
      const data=JSON.parse(options.body);assert.equal(data.expected_version,current.version);
      current.state=data.state;current.version++;return {version:current.version};
    }
    return structuredClone(current);
  }};
  w.HTMLElement.prototype.scrollIntoView=function(){};
  Object.defineProperty(w.navigator,'clipboard',{value:{writeText:async()=>{}}});
  w.eval(fs.readFileSync(path.join(root,'sidebar.js'),'utf8'));
  w.eval(fs.readFileSync(path.join(root,'workspace.js'),'utf8'));
  await tick();
  t.after(()=>w.close());
  const q=s=>d.querySelector(s),click=s=>q(s).click(),submit=()=>q('#composer-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
  return {w,d,q,click,submit,records,calls,state:()=>records.get(spaceId).state};
}

test('a new workspace has its real name, empty history and no authored sample papers or answers',async t=>{
 const u=await setup(t);assert.equal(u.q('[data-workspace-name]').textContent,'我的课题-space-a');
 assert.equal(u.d.querySelectorAll('.comparison-table,.context-chip,.history-row').length,0);
 assert.match(u.q('#history-list').textContent,/还没有对话/);
 assert.equal(u.calls.filter(c=>c.options.method==='PUT').length,0);
 assert.doesNotMatch(u.d.body.textContent,/分子图学习|分子图表示学习|Neural Message Passing/);
});

test('legacy browser-wide demo names and histories cannot leak into a selected workspace',async t=>{
 const u=await setup(t,{saved:{'lexivault.workspace.v1':JSON.stringify({workspaceName:'旧空间',conversations:[{id:'old',title:'旧对话'}]})}});
 assert.doesNotMatch(u.q('#history-list').textContent,/旧对话/);assert.doesNotMatch(u.q('[data-workspace-name]').textContent,/旧空间/);
 assert.ok(u.w.localStorage.getItem('lexivault.workspace.v1'));
});

test('questions persist in the workspace service and restore on a different page instance',async t=>{
 const u=await setup(t);u.q('#question').value='我的研究问题';u.submit();await tick();
 assert.equal(u.state().conversations[0].messages.length,2);
 assert.match(u.q('.service-message').textContent,/模型服务尚未连接/);
 const restored=await setup(t,{records:u.records});assert.equal(restored.q('#conversation-title').textContent,'我的研究问题');
 assert.match(restored.q('#conversation').textContent,/我的研究问题/);
});

test('switching workspace IDs isolates titles and conversations',async t=>{
 const a=await setup(t);a.q('#question').value='甲空间的问题';a.submit();await tick();
 const b=await setup(t,{records:a.records,spaceId:'space-b'});
 assert.doesNotMatch(b.q('#history-list').textContent,/甲空间/);assert.equal(b.state().conversations.length,0);
 const restored=await setup(t,{records:a.records});assert.match(restored.q('#history-list').textContent,/甲空间/);
});

test('without an open workspace users cannot create orphan browser conversations',async t=>{
 const u=await setup(t,{unselected:true});u.click('#new-chat');u.q('#question').value='未选空间';u.submit();await tick();
 assert.equal(u.state().conversations.length,0);assert.equal(u.calls.length,0);
 assert.match(u.q('#workspace-toast').textContent,/打开工作空间|打开工作空间|文献阅读/);
});

test('empty selected-document scope does not send a model request',async t=>{
 let calls=0;const u=await setup(t,{adapter:{ask:()=>calls++}});
 u.click('[data-scope="selected"]');u.q('#question').value='提问';u.submit();await tick();
 assert.equal(calls,0);assert.equal(u.state().conversations.length,0);assert.match(u.q('#workspace-toast').textContent,/选择用于回答的文献/);
});

test('model output is rendered as text and receives only actual selected workspace papers',async t=>{
 let request;const u=await setup(t,{adapter:{ask:async value=>{request=value;return {message:'<img src=x>研究结果',citations:[{documentId:'paper-one'},{documentId:'other-space'}]};}}});
 u.q('#question').value='核验证据';u.submit();await tick();
 assert.deepEqual(Array.from(request.documentIds),['paper-one']);assert.equal(u.q('.dynamic-message img'),null);
 assert.match(u.q('.dynamic-message .answer-content').textContent,/<img src=x>/);
 assert.equal(u.d.querySelectorAll('.dynamic-message .citation-chip').length,1);
});

test('stop cancels a request and ignores a response after a new conversation',async t=>{
 let finish,signal;const u=await setup(t,{adapter:{ask:input=>{signal=input.signal;return new Promise(resolve=>finish=resolve);}}});
 u.q('#question').value='开始';u.submit();await tick();u.submit();assert.equal(signal.aborted,true);
 u.click('#new-chat');finish({message:'迟到的回答'});await tick();assert.equal(u.q('.dynamic-message'),null);
});

test('IME composition and Shift+Enter preserve the unsent Chinese draft',async t=>{
 const u=await setup(t);u.q('#question').value='中文草稿';
 for(const options of [{isComposing:true},{shiftKey:true}])u.q('#question').dispatchEvent(new u.w.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true,...options}));
 await tick();assert.equal(u.state().conversations.length,0);assert.equal(u.q('#question').value,'中文草稿');
});

test('failed or conflicting saves retain a workspace-specific recoverable draft',async t=>{
 const u=await setup(t,{failSave:true});u.q('#question').value='保留我的草稿';u.submit();await tick();
 const draft=u.w.localStorage.getItem('lexivault.assistant.space-a');assert.match(draft,/保留我的草稿/);
 assert.equal(u.state().conversations.length,0);assert.match(u.q('#workspace-toast').textContent,/草稿保留/);
 const recovered=await setup(t,{saved:{'lexivault.assistant.space-a':draft}});
 const button=[...recovered.d.querySelectorAll('button')].find(b=>b.textContent==='合并恢复草稿');assert.ok(button);button.click();await tick();
 assert.equal(recovered.state().conversations[0].messages[0].text,'保留我的草稿');
});

test('navigation keeps all six dedicated feature routes and responsive sidebar behavior',async t=>{
 const u=await setup(t);assert.deepEqual([...u.d.querySelectorAll('[data-workspace-route]')].map(n=>n.getAttribute('href')),['home.html','discover.html','reader.html','plans.html','graph.html','knowledge.html']);
 u.click('#sidebar-surface');assert.equal(u.w.LexiVaultSidebar.mode,'expanded');u.click('#sidebar-surface');assert.equal(u.w.LexiVaultSidebar.mode,'compact');
});
