import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bundle = await build({ entryPoints: [path.join(root, 'src/reader/app.js')], bundle: true, write: false, format: 'iife',
  define: { 'import.meta.url': JSON.stringify('http://localhost/generated/reader.js'),__PDFJS_WORKER_URL__:JSON.stringify('/vendor/pdf.worker.test.js') },
  plugins: [{ name: 'pdf-fixture', setup(builder) {
    builder.onResolve({ filter: /^pdfjs-dist/ }, () => ({ path: 'pdf-fixture', namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `
      export const GlobalWorkerOptions={};
      export class TextLayer { async render(){} cancel(){} }
      export function getDocument(){ if(globalThis.readerPDFOpenFailures){globalThis.readerPDFOpenFailures--;return {promise:Promise.reject(new Error('Setting up fake worker failed: cached module'))};} return {promise:Promise.resolve({numPages:3,async destroy(){},async getPage(){return {
        getViewport({scale}){return {width:500*scale,height:700*scale}},render(){return {promise:Promise.resolve(),cancel(){}}},async getTextContent(){return {items:[]}}
      }}})} }` }));
  } }] });

async function until(predicate) {
  for (let i = 0; i < 120; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 10)); }
  assert.fail('Reader did not reach expected state');
}

async function fixture(t,{nested=false,libraryCollapsed=false,createFailures=[],trashFailure=false,saveFailure=false}={}) {
  const dom = new JSDOM(fs.readFileSync(path.join(root, 'dist/reader.html'), 'utf8'), { url: 'http://localhost/reader.html', runScripts: 'outside-only', pretendToBeVisual: true });
  const { window: w } = dom, d = w.document;
  const docs = ['a'.repeat(32), 'b'.repeat(32)].map((id, index) => ({ id, title: `论文${index + 1}`, filename: 'paper.pdf', page_count: 3, last_page: 1, sha256: 'c'.repeat(64), file_available: true, source: 'local' }));
  const notes = new Map(docs.map(doc => [doc.id, { markdown: `${doc.title}原笔记`, revision: 'r1', missing: false, path: `notes/${doc.id}.md` }]));
  const copies = [], saves = [], sockets = [], fileLoads = [], folderCreates = [], imports = [], trashed = [], restored = [];
  w.localStorage.setItem('lexivault.reader.library-collapsed', String(libraryCollapsed));
  const space={id:'workspace',name:'真实工作空间',path:'/local/workspace',...(nested?{layout:'files'}:{})};
  if(nested){docs[0].rel_path='课题/图学习/一.pdf';docs[1].rel_path='课题/综述/二.pdf';}
  const entries=[{kind:'folder',path:'课题',name:'课题'},{kind:'folder',path:'课题/图学习',name:'图学习'},{kind:'folder',path:'课题/综述',name:'综述'},...docs.map(d=>({kind:'pdf',path:d.rel_path,name:d.rel_path?.split('/').pop(),document_id:d.id}))];
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
  w.HTMLCanvasElement.prototype.getContext = () => ({});
  let resizePDF;
  w.ResizeObserver = class { constructor(callback) { resizePDF = callback; } observe() {} disconnect() {} };
  w.WebSocket = class { constructor() { sockets.push(this); } close() {} };
  w.confirm = () => true;
  w.setInterval = () => 1;
  w.fetch = async (url, options = {}) => {
    let body, code = 200;
    const id = url.match(/documents\/([a-f0-9]+)/)?.[1];
    const incoming = typeof options.body === 'string' ? JSON.parse(options.body) : null;
    if (url === '/api/session') body = { token: 'test', data_dir: '/local' };
    else if (url === '/api/workspaces') body = [space];
    else if (url === '/api/workspace/current') body=space;
    else if(url.endsWith('/files')) {
      if(options.method==='POST') {
        const relative=[incoming.parent,incoming.name].filter(Boolean).join('/');
        const failure=createFailures.shift();
        if(failure){code=failure;body={message:failure===409?'同名文件或文件夹已存在。':'暂时无法创建文件夹'};if(failure===409)entries.push({kind:'folder',path:relative,name:incoming.name});}
        else if(entries.some(e=>e.path===relative)){code=409;body={message:'同名文件或文件夹已存在。'};}
        else {folderCreates.push(incoming);entries.push({kind:'folder',path:relative,name:incoming.name});body={path:relative};}
      } else body={entries,warnings:[]};
    }
    else if(url.endsWith('/files/delete')) {
      if(trashFailure){code=500;body={message:'无法移动到回收站'};}
      else {
        const removed=entries.filter(e=>e.path===incoming.path||e.path.startsWith(incoming.path+'/'));
        trashed.push({path:incoming.path,entries:removed});
        for(let i=entries.length-1;i>=0;i--)if(removed.includes(entries[i]))entries.splice(i,1);
        for(const e of removed)if(e.kind==='pdf'){const doc=docs.find(d=>d.id===e.document_id);if(doc)doc.trashed=true;}
        body={path:incoming.path,destination:'system_trash'};
      }
    }
    else if(url.endsWith('/imports')) {imports.push({directory:options.body.get('directory'),file:options.body.get('file').name});body={...docs[1],duplicate:true};}
    else if(url.endsWith('/history'))body=[{id:'d'.repeat(64),modified_at:1234567890}];
    else if(url.includes('/history/'))body={markdown:'历史中的正文'};
    else if (url.endsWith('/documents')) body = docs.filter(d=>!d.trashed);
    else if (url.endsWith('/open')) body = {id:'workspace'};
    else if (url.includes('/file?')) { fileLoads.push(url); body = {}; }
    else if (url.endsWith('/position')) body = { saved: true };
    else if (url.endsWith('/conflicts')) { copies.push(incoming.markdown); body = { path: '/local/conflicts/copy.md' }; }
    else if (url.endsWith('/note')) {
      if (options.method === 'PUT') {
        const current = notes.get(id);
        if(saveFailure){code=500;body={message:'笔记保存失败'};}
        else if (current.revision !== incoming.expected_revision) { code = 409; body = { message: '外部文件已修改', current }; }
        else { body = { ...current, markdown: incoming.markdown, revision: `saved-${saves.length}` }; notes.set(id, body); saves.push({ id, text: incoming.markdown }); }
      } else body = notes.get(id);
    } else throw new Error(`Unexpected request: ${url}`);
    return { ok: code === 200, status: code, async json() { return structuredClone(body); }, async arrayBuffer() { return new ArrayBuffer(0); } };
  };
  w.eval(bundle.outputFiles[0].text);
  t.after(() => w.close());
  await until(() => d.querySelectorAll('.reader-document').length === 2);
  d.querySelector('.reader-document').click();
  await until(() => !d.querySelector('#reader-note').disabled && d.querySelector('#reader-pages').textContent === '/ 3');
  const edit = (text) => { const input = d.querySelector('#reader-note'); input.value = text; input.dispatchEvent(new w.Event('input', { bubbles: true })); };
  let externalVersion = 0;
  const external = (text) => { notes.set(docs[0].id, { ...notes.get(docs[0].id), markdown: text, revision: `external-${++externalVersion}` }); sockets.at(-1).onmessage({ data: JSON.stringify({ type: 'workspace_changed' }) }); };
  return { w, d, notes, docs, copies, saves, edit, external, fileLoads, resizePDF, folderCreates, imports, entries, trashed, restored,
    poll:()=>sockets.at(-1).onmessage({data:JSON.stringify({type:'workspace_changed'})}) };
}

test('reader saves Markdown to the correct document and inserts versioned page references', async t => {
  const f = await fixture(t);
  f.edit('## 我的理解');
  f.d.querySelector('#reader-cite').click();
  f.d.querySelector('#reader-save').click();
  await until(() => f.saves.length === 1);
  assert.match(f.saves[0].text, /paper:\/\/a{32}\?revision=c{64}&page=1/);
  assert.equal(f.saves[0].id, f.docs[0].id);
  assert.equal(f.notes.get(f.docs[1].id).markdown, '论文2原笔记');
});

test('clean notes reload external changes; conflicting drafts stop navigation and survive as a copy', async t => {
  const f = await fixture(t);
  f.external('外部首次更新');
  await until(() => f.d.querySelector('#reader-note').value === '外部首次更新');
  f.edit('页面尚未保存的草稿');
  f.external('外部第二次更新');
  await until(() => !f.d.querySelector('#reader-conflict').hidden);
  assert.equal(f.d.querySelector('#reader-note').value, '页面尚未保存的草稿');
  f.d.querySelectorAll('.reader-document')[1].click();
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(f.d.querySelector('#reader-title').textContent, '论文1');
  assert.equal(f.saves.length, 0);
  f.d.querySelector('#reader-keep-copy').click();
  await until(() => f.copies.length && f.d.querySelector('#reader-note').value === '外部第二次更新');
  assert.deepEqual(f.copies, ['页面尚未保存的草稿']);
});

test('preview sanitizes external content and preserves clickable paper citations', async t => {
  const f = await fixture(t);
  f.edit('<script>alert(1)</script><img src="https://example.invalid/tracker"><a href="javascript:alert(1)">bad</a>\n\n[页码](paper://' + f.docs[0].id + '?revision=' + f.docs[0].sha256 + '&page=2)');
  f.d.querySelector('#reader-preview-tab').click();
  const preview = f.d.querySelector('#reader-note-preview');
  assert.equal(preview.querySelectorAll('script,img,[href^="javascript:"]').length, 0);
  assert.match(preview.querySelector('a[href^="paper:"]').href, /page=2/);
});


test('reader starts directly with three panes and keeps workspace controls in shared sidebar',async t=>{
 const f=await fixture(t);assert.equal(f.d.querySelector('.s-topbar'),null);assert.equal(f.d.querySelector('.reader-workspace-bar'),null);assert.equal(f.d.querySelector('#reader-workspace'),null);assert.equal(f.d.querySelector('#reader-create'),null);
 assert.ok(f.d.querySelector('.reader-columns>.reader-library'));assert.ok(f.d.querySelector('.reader-columns>.reader-paper'));assert.ok(f.d.querySelector('.reader-columns>.reader-notes'));
 f.d.querySelector('#reader-note-settings-open').click();assert.ok(f.d.querySelector('#reader-note-settings').open);assert.equal(f.d.querySelector('#reader-note-location').closest('dialog').id,'reader-note-settings');
});

test('nested filesystem folders open papers and keep their expansion on file refresh',async t=>{
 const f=await fixture(t,{nested:true});const folder=()=>f.d.querySelector('[data-folder-path="课题/图学习"]');
 assert.equal(folder().parentElement.closest('[data-folder-path]').dataset.folderPath,'课题');assert.equal(folder().querySelector('.reader-document').dataset.paperPath,'课题/图学习/一.pdf');
 assert.ok(folder().open);f.d.querySelector('[data-folder-path="课题/综述"]>summary').click();await new Promise(r=>setTimeout(r,20));
 f.d.querySelector('#reader-refresh').click();await new Promise(r=>setTimeout(r,30));assert.ok(f.d.querySelector('[data-folder-path="课题/综述"]').open);
 const search=f.d.querySelector('#reader-search');search.value='综述';search.dispatchEvent(new f.w.Event('input'));assert.equal(f.d.querySelectorAll('.reader-document').length,1);f.d.querySelector('.reader-document').click();
 await until(()=>f.d.querySelector('#reader-title').textContent==='论文2');assert.match(f.d.querySelector('#reader-root').textContent,/课题\/综述/);assert.equal(f.d.querySelector('#reader-note-document').textContent,'论文2');
});

test('history remains usable after moving note settings out of the reading panes',async t=>{
 const f=await fixture(t);f.d.querySelector('#reader-history').click();await until(()=>f.d.querySelector('#reader-history-dialog').open);assert.equal(f.d.querySelectorAll('.reader-history-item').length,1);
 f.d.querySelector('.reader-history-item').click();await until(()=>!f.d.querySelector('#reader-history-use').disabled);assert.equal(f.d.querySelector('#reader-history-text').value,'历史中的正文');
 f.d.querySelector('#reader-history-use').click();assert.equal(f.d.querySelector('#reader-note').value,'历史中的正文');
});

test('paper, directory and note pane controls preserve the current draft',async t=>{
 const f=await fixture(t);f.edit('切换面板仍保留的笔记');
 for(const pane of ['list','paper','note']){f.d.querySelector(`[data-reader-pane="${pane}"]`).click();assert.equal(f.d.querySelector('.reading-workspace').dataset.pane,pane);assert.equal(f.d.querySelector('#reader-note').value,'切换面板仍保留的笔记');}
});

test('PDF import options stay in a dialog instead of occupying the paper directory',async t=>{
 const f=await fixture(t);assert.equal(f.d.querySelector('.reader-library input[type=file]'),null);assert.equal(f.d.querySelector('#reader-files').closest('dialog').id,'reader-import-dialog');
 f.d.querySelector('#reader-import-open').click();assert.equal(f.d.querySelector('#reader-import-dialog').open,true);
});

test('directory toggle preserves the paper, page, folder expansion and note draft', async t => {
  const f = await fixture(t, {nested:true});
  const toggle = f.d.querySelector('#reader-library-toggle');
  const library = f.d.querySelector('#reader-library');
  const folder = f.d.querySelector('[data-folder-path="课题/图学习"]');
  const canvas = f.d.querySelector('#reader-canvas');
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  assert.equal(toggle.closest('.reader-paper-heading').firstElementChild, toggle);
  f.d.querySelector('#reader-next').click();
  await until(() => f.d.querySelector('#reader-page').value === '2');
  f.edit('收起目录时保留的草稿');
  toggle.click();
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(toggle.getAttribute('aria-label'), '展开论文目录');
  assert.equal(library.inert, true);
  assert.equal(f.w.localStorage.getItem('lexivault.reader.library-collapsed'), 'true');
  toggle.click();
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  assert.equal(library.inert, false);
  assert.equal(f.d.querySelector('#reader-note').value, '收起目录时保留的草稿');
  assert.equal(f.d.querySelector('#reader-page').value, '2');
  assert.equal(f.d.querySelector('#reader-canvas'), canvas);
  assert.equal(folder.open, true);
  assert.equal(f.fileLoads.length, 1);
});

test('saved directory preference does not block the mobile directory tab', async t => {
  const f = await fixture(t, {libraryCollapsed:true});
  assert.equal(f.d.querySelector('#reader-library-toggle').getAttribute('aria-expanded'), 'false');
  Object.defineProperty(f.w, 'innerWidth', {value:700, configurable:true});
  f.w.dispatchEvent(new f.w.Event('resize'));
  f.d.querySelector('[data-reader-pane="list"]').click();
  assert.equal(f.d.querySelector('#reader-library').inert, false);
  assert.equal(f.d.querySelector('#reader-library').getAttribute('aria-hidden'), null);
  assert.equal(f.d.querySelector('.reading-workspace').dataset.pane, 'list');
  Object.defineProperty(f.w, 'innerWidth', {value:1280, configurable:true});
  f.w.dispatchEvent(new f.w.Event('resize'));
  assert.equal(f.d.querySelector('#reader-library').inert, true);
  assert.equal(f.d.querySelector('#reader-library-toggle').getAttribute('aria-expanded'), 'false');
});

test('fitting PDF after the directory width changes preserves the reading position', async t => {
  const f = await fixture(t);
  const scroll = f.d.querySelector('#reader-pdf-scroll');
  Object.defineProperty(scroll, 'clientWidth', {value:502, configurable:true});
  f.d.querySelector('#reader-fit').click();
  await until(() => f.d.querySelector('#reader-canvas').style.height === '700px');
  scroll.scrollTop = 210;
  Object.defineProperty(scroll, 'clientWidth', {value:752, configurable:true});
  f.d.querySelector('#reader-library-toggle').click();
  f.resizePDF();
  await until(() => f.d.querySelector('#reader-canvas').style.height === '1050px');
  await until(() => scroll.scrollTop === 315);
  assert.equal(f.d.querySelector('#reader-page').value, '1');
  assert.equal(f.fileLoads.length, 1);
});

test('creating a subfolder selects it for PDF import and preserves the current note', async t => {
  const f = await fixture(t, {nested:true});
  f.edit('创建文件夹时仍保留的笔记');
  f.d.querySelector('#reader-new-folder').click();
  assert.equal(f.d.querySelector('#reader-folder-dialog'), null);
  const inputName=f.d.querySelector('#reader-folder-name');
  assert.equal(inputName.closest('[data-folder-children]').dataset.folderChildren,'课题/图学习');
  assert.equal(inputName.value,'未命名');
  assert.equal(inputName.selectionStart,0);assert.equal(inputName.selectionEnd,3);
  inputName.value = '待读论文';inputName.dispatchEvent(new f.w.Event('input',{bubbles:true}));
  inputName.dispatchEvent(new f.w.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
  await until(() => !f.d.querySelector('#reader-folder-name'));
  assert.deepEqual(f.folderCreates, [{parent:'课题/图学习',name:'待读论文',kind:'folder'}]);
  const folder = f.d.querySelector('[data-folder-path="课题/图学习/待读论文"]');
  assert.equal(folder.open, true);
  assert.ok(folder.querySelector('summary').classList.contains('is-selected'));
  assert.equal(f.d.querySelector('#reader-note').value, '创建文件夹时仍保留的笔记');
  f.d.querySelector('#reader-import-open').click();
  assert.equal(f.d.querySelector('#reader-import-folder').value, '课题/图学习/待读论文');
  const input=f.d.querySelector('#reader-files');
  Object.defineProperty(input,'files',{value:[new f.w.File(['sample PDF'],'论文.pdf',{type:'application/pdf'})],configurable:true});
  input.dispatchEvent(new f.w.Event('change',{bubbles:true}));
  await until(() => f.imports.length===1);
  assert.deepEqual(f.imports, [{directory:'课题/图学习/待读论文',file:'论文.pdf'}]);
});

test('inline folder creation supports root, Escape, and numbered default names', async t => {
  const f = await fixture(t, {nested:true});
  f.d.querySelector('#reader-tree-root').click();
  f.d.querySelector('#reader-new-folder').click();
  assert.equal(f.d.querySelector('.reader-folder-draft').parentElement.id,'reader-documents');
  f.d.querySelector('#reader-folder-name').value = '取消的目录';
  f.d.querySelector('#reader-folder-name').dispatchEvent(new f.w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
  assert.equal(f.d.querySelector('#reader-folder-name'),null);
  assert.equal(f.folderCreates.length,0);
  for(const name of ['未命名','未命名1','未命名2']){
    f.d.querySelector('#reader-tree-root').click();f.d.querySelector('#reader-new-folder').click();
    const input=f.d.querySelector('#reader-folder-name');assert.equal(input.value,name);
    input.dispatchEvent(new f.w.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
    await until(()=>!f.d.querySelector('#reader-folder-name'));
    assert.equal(f.folderCreates.at(-1).parent,'');assert.equal(f.folderCreates.at(-1).name,name);
  }
});

test('duplicate folder input shows feedback immediately and Enter creates a safe default', async t => {
  const f = await fixture(t, {nested:true});
  f.d.querySelector('#reader-tree-root').click();
  f.d.querySelector('#reader-new-folder').click();
  const input=f.d.querySelector('#reader-folder-name');input.value='课题';input.dispatchEvent(new f.w.Event('input',{bubbles:true}));
  assert.match(f.d.querySelector('#reader-folder-error').textContent,/已经存在同名文件夹/);
  assert.equal(f.d.querySelector('#reader-folder-error').parentElement,f.d.body);
  input.dispatchEvent(new f.w.Event('blur'));
  assert.equal(f.folderCreates.length,0);
  input.dispatchEvent(new f.w.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
  await until(()=>!f.d.querySelector('#reader-folder-name'));
  assert.deepEqual(f.folderCreates,[{parent:'',name:'未命名',kind:'folder'}]);
  assert.equal(f.entries.filter(e=>e.path==='课题').length,1);
});

test('polling and IME do not interrupt inline folder input or accidentally create it', async t => {
  const f=await fixture(t,{nested:true});
  f.d.querySelector('#reader-new-folder').click();const input=f.d.querySelector('#reader-folder-name');
  input.dispatchEvent(new f.w.CompositionEvent('compositionstart'));input.value='中文输入';input.setSelectionRange(2,2);
  input.dispatchEvent(new f.w.KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true}));
  f.entries.push({kind:'folder',path:'课题/图学习/外部文件夹',name:'外部文件夹'});f.poll();
  await until(()=>[...f.d.querySelector('#reader-import-folder').options].some(o=>o.text.includes('外部文件夹')));
  assert.equal(f.d.querySelector('#reader-folder-name'),input);assert.equal(f.d.activeElement,input);assert.equal(input.selectionStart,2);
  assert.equal(f.folderCreates.length,0);
  input.dispatchEvent(new f.w.CompositionEvent('compositionend'));input.dispatchEvent(new f.w.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
  await until(()=>!f.d.querySelector('#reader-folder-name'));
  assert.equal(f.folderCreates[0].name,'中文输入');
});

test('external name collisions retry with an unused default without overwriting anything', async t => {
  const f=await fixture(t,{nested:true,createFailures:[409,409]});
  f.d.querySelector('#reader-tree-root').click();f.d.querySelector('#reader-new-folder').click();
  const input=f.d.querySelector('#reader-folder-name');
  input.dispatchEvent(new f.w.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
  await until(()=>!f.d.querySelector('#reader-folder-name'));
  assert.deepEqual(f.folderCreates,[{parent:'',name:'未命名2',kind:'folder'}]);
  assert.ok(f.entries.some(e=>e.path==='未命名'));assert.ok(f.entries.some(e=>e.path==='未命名1'));
});

test('invalid names and request failures preserve an editable draft; blur saves valid input', async t => {
  const f=await fixture(t,{nested:true,createFailures:[500]});
  f.d.querySelector('#reader-new-folder').click();const input=f.d.querySelector('#reader-folder-name');
  input.value='../外部目录';input.dispatchEvent(new f.w.Event('input',{bubbles:true}));
  input.dispatchEvent(new f.w.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
  assert.equal(f.folderCreates.length,0);assert.equal(input.getAttribute('aria-invalid'),'true');
  input.value='可重试的新目录';input.dispatchEvent(new f.w.Event('input',{bubbles:true}));
  input.dispatchEvent(new f.w.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
  await until(()=>f.d.querySelector('#reader-folder-error').textContent.includes('暂时无法'));
  assert.equal(input.readOnly,false);assert.equal(input.value,'可重试的新目录');
  input.dispatchEvent(new f.w.Event('blur'));
  await until(()=>!f.d.querySelector('#reader-folder-name'));
  assert.equal(f.folderCreates.length,1);
});

test('folder deletion uses the system bin, preserves notes and recognizes externally restored files', async t => {
  const f=await fixture(t,{nested:true});
  const folder=()=>f.d.querySelector('[data-folder-path="课题/图学习"]>summary');
  f.edit('删除目录前保存的笔记');
  folder().dispatchEvent(new f.w.KeyboardEvent('keydown',{key:'Delete',bubbles:true}));
  assert.equal(f.d.querySelector('#reader-delete-dialog').open,true);
  assert.match(f.d.querySelector('#reader-delete-description').textContent,/所有文件/);
  assert.equal(f.trashed.length,0);
  f.d.querySelector('#reader-delete-dialog [data-reader-close]').click();
  assert.equal(f.trashed.length,0);
  folder().dispatchEvent(new f.w.KeyboardEvent('keydown',{key:'Delete',bubbles:true}));
  f.d.querySelector('#reader-delete-confirm').click();
  await until(()=>f.trashed.length===1&&!f.d.querySelector('#reader-delete-dialog').open);
  await until(()=>!folder());
  assert.equal(f.saves[0].text,'删除目录前保存的笔记');
  assert.equal(f.trashed[0].path,'课题/图学习');
  assert.equal(f.d.querySelector('#reader-title').textContent,'选择一篇论文');
  assert.equal(f.d.querySelector('#reader-note').disabled,true);
  assert.equal(f.d.querySelector('#reader-undo-trash'),null);
  assert.equal(f.d.querySelector('#reader-trash-feedback'),null);
  assert.match(f.d.querySelector('#reader-delete-status').textContent,/电脑系统回收站/);
  assert.equal(f.d.querySelector('#reader-import-folder').value,'课题');
  f.entries.push(...f.trashed[0].entries);f.docs[0].trashed=false;f.poll();
  await until(()=>!!folder());
  assert.ok(f.entries.some(e=>e.path==='课题/图学习/一.pdf'));
  assert.equal(f.notes.get(f.docs[0].id).markdown,'删除目录前保存的笔记');
});

test('a PDF trash button deletes only that PDF and does not open it or close a different paper', async t => {
  const f=await fixture(t,{nested:true});
  const button=[...f.d.querySelectorAll('.reader-entry-delete')].find(b=>b.dataset.paperPath==='课题/综述/二.pdf');
  assert.equal(button.getAttribute('aria-label'),'删除 二.pdf');
  button.click();assert.equal(f.d.querySelector('#reader-delete-dialog').open,true);
  assert.equal(f.d.querySelector('#reader-title').textContent,'论文1');
  f.d.querySelector('#reader-delete-confirm').click();
  await until(()=>f.trashed.length===1&&!f.d.querySelector('#reader-delete-dialog').open);
  assert.equal(f.trashed[0].path,'课题/综述/二.pdf');
  assert.equal(f.d.querySelector('#reader-title').textContent,'论文1');
  assert.equal(f.d.querySelector('#reader-note').value,'论文1原笔记');
  assert.equal(f.fileLoads.length,1);
});

test('Delete while editing a name leaves files alone and failures preserve notes and the directory', async t => {
  const f=await fixture(t,{nested:true,trashFailure:true});
  f.d.querySelector('#reader-new-folder').click();const input=f.d.querySelector('#reader-folder-name');
  input.dispatchEvent(new f.w.KeyboardEvent('keydown',{key:'Delete',bubbles:true}));
  assert.equal(f.d.querySelector('#reader-delete-dialog').open,false);assert.equal(f.trashed.length,0);
  input.dispatchEvent(new f.w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
  f.d.querySelector('[data-folder-path="课题/图学习"] .reader-entry-delete').click();
  f.d.querySelector('#reader-delete-confirm').click();
  await until(()=>!f.d.querySelector('#reader-delete-error').hidden);
  assert.equal(f.trashed.length,0);assert.equal(f.d.querySelector('#reader-title').textContent,'论文1');
  assert.ok(f.d.querySelector('[data-folder-path="课题/图学习"]'));
});

test('a failed note save blocks deleting the active paper or its directory', async t => {
  const f=await fixture(t,{nested:true,saveFailure:true});f.edit('不能丢失的未保存笔记');
  f.d.querySelector('[data-folder-path="课题/图学习"] .reader-entry-delete').click();
  f.d.querySelector('#reader-delete-confirm').click();
  await until(()=>!f.d.querySelector('#reader-delete-confirm').disabled);
  assert.equal(f.trashed.length,0);assert.equal(f.d.querySelector('#reader-note').value,'不能丢失的未保存笔记');
  assert.ok(f.d.querySelector('[data-folder-path="课题/图学习"]'));
});

test('clicking the same paper after a worker failure retries loading and saves the note draft',async t=>{
  const f=await fixture(t);f.w.readerPDFOpenFailures=1;
  f.d.querySelectorAll('.reader-document')[1].click();
  await until(()=>f.d.querySelector('#reader-pdf-status').textContent.includes('cached module'));
  assert.equal(f.d.querySelector('#reader-pages').textContent,'/ 0');
  f.edit('加载失败后仍需保留的笔记');
  f.d.querySelectorAll('.reader-document')[1].click();
  await until(()=>f.d.querySelector('#reader-pages').textContent==='/ 3');
  assert.equal(f.fileLoads.length,3);assert.equal(f.d.querySelector('#reader-title').textContent,'论文2');
  assert.equal(f.notes.get(f.docs[1].id).markdown,'加载失败后仍需保留的笔记');
});
