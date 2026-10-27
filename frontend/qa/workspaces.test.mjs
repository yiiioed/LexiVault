import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM} from 'jsdom';
import {initialState} from '../src/discover/model.js';
import {EXAMPLE_PAPERS} from '../src/discover/catalog.js';

test('production discovery starts without sample papers, preset searches or queue entries',()=>{
 assert.equal(EXAMPLE_PAPERS.length,0);
 assert.equal(initialState().queue.length,0);assert.equal(initialState().filters.query,'');
});

test('common navigation reads actual current workspace and its history instead of global browser demos',async t=>{
 const dom=new JSDOM('<body data-feature="reader"><span data-workspace-name>选择工作空间</span><button id="workspace-selector"></button><div id="workspace-menu"><div id="workspace-list"></div><p id="workspace-menu-status" hidden></p><button id="new-workspace">新建工作空间</button></div><div id="history-list"></div></body>',{url:'http://localhost/reader.html',runScripts:'outside-only'});
 t.after(()=>dom.window.close());const w=dom.window;
 w.localStorage.setItem('lexivault.workspace.v1',JSON.stringify({workspaceName:'分子图学习',conversations:[{id:'old',title:'旧示例'}]}));
 const calls=[];w.fetch=async(url,options)=>{calls.push({url,options});const value=url==='/api/session'?{token:'local-token'}:url==='/api/workspace/current'?{id:'real',name:'我的文献空间'}:url==='/api/workspaces'?[{id:'real',name:'我的文献空间'}]:{state:{conversations:[{id:'mine',title:'<img src=x>自己的问题'}]}};return {ok:true,json:async()=>value};};
 w.eval(fs.readFileSync(new URL('../src/workspace-client.js',import.meta.url),'utf8'));
 await w.LexiVaultSpace.ready;
 assert.equal(w.document.querySelector('[data-workspace-name]').textContent,'我的文献空间');
 assert.equal(w.document.querySelector('#history-list img'),null);
 assert.match(w.document.querySelector('#history-list').textContent,/自己的问题/);
 assert.doesNotMatch(w.document.querySelector('#history-list').textContent,/旧示例/);
 assert.equal(w.document.querySelector('#workspace-menu a'),null);
 assert.equal(w.document.querySelector('[data-workspace-id=real]').textContent,'我的文献空间当前');
 assert.equal(w.document.querySelector('#new-workspace').textContent,'新建工作空间');
 assert.equal(calls.at(-1).url,'/api/workspaces/real/assistant');
});
