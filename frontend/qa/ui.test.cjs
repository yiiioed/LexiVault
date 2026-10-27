const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {parseHTML} = require('linkedom');
const validation = require('./load-validation.cjs');

function setup(adapter) {
  const {window, document} = parseHTML(fs.readFileSync(path.join(__dirname,'../dist/index.html'),'utf8'));
  const saved = new Map(); const navigation = []; const sessionSaved = new Map();
  const localStorage = {getItem:k=>saved.get(k)??null,setItem:(k,v)=>saved.set(k,String(v)),removeItem:k=>saved.delete(k)};
  const sessionStorage = {getItem:k=>sessionSaved.get(k)??null,setItem:(k,v)=>sessionSaved.set(k,String(v))};
  const location = {href:'https://lexivault.example/',origin:'https://lexivault.example',assign:url=>navigation.push(url)};
  window.localStorage=localStorage; window.location=location;
  window.LexiVaultValidation=validation; window.lexivaultAuth=adapter;
  window.self=window; window.top=window;
  window.HTMLElement.prototype.focus=function(){document.activeElement=this;};
  document.querySelectorAll('input').forEach(input=>{input.checked=input.hasAttribute('checked');});
  document.querySelectorAll('dialog').forEach(dialog=>{
    dialog.showModal=function(){this.setAttribute('open','');};
    dialog.close=function(){this.removeAttribute('open');};
  });
  const context=vm.createContext({window,document,localStorage,sessionStorage,location,console,URL,AbortController,CustomEvent:window.CustomEvent,setTimeout,clearTimeout});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../dist/app.js'),'utf8'),context);
  const q=selector=>document.querySelector(selector);
  const click=selector=>q(selector).dispatchEvent(new window.Event('click',{bubbles:true,cancelable:true}));
  const submit=()=>q('#auth-form').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));
  const tick=()=>new Promise(resolve=>setImmediate(resolve));
  return {q,click,submit,tick,saved,sessionSaved,navigation,document,window};
}
test('theme changes pressed states and persists the selected theme',()=>{
  const ui=setup();
  assert.equal(ui.document.documentElement.dataset.theme,'light');
  ui.click('#theme-dark');
  assert.equal(ui.document.documentElement.dataset.theme,'dark');
  assert.equal(ui.q('#theme-dark').getAttribute('aria-pressed'),'true');
  assert.equal(ui.q('#theme-light').getAttribute('aria-pressed'),'false');
  assert.equal(ui.saved.get('lexivault.theme'),'dark');
  ui.click('#theme-light'); assert.equal(ui.document.documentElement.dataset.theme,'light');
});
test('language switch updates document language, all labels, and accessible names',()=>{
  const ui=setup(); ui.click('#language-button');
  assert.equal(ui.q('#language-menu').hidden,false);
  ui.click('[data-language="en"]');
  assert.equal(ui.document.documentElement.lang,'en');
  assert.equal(ui.q('#auth-heading').textContent,'Welcome back to LexiVault');
  assert.equal(ui.q('#theme-dark').getAttribute('aria-label'),'Dark mode');
  assert.equal(ui.q('#language-menu').hidden,true);
});
test('registration has confirmation, proper autofill, tab ARIA, and clears passwords when leaving',()=>{
  const ui=setup(); ui.click('#tab-register');
  assert.equal(ui.q('#confirm-field').hidden,false);
  assert.equal(ui.q('#login-options').hidden,true);
  assert.equal(ui.q('#password').autocomplete,'new-password');
  assert.equal(ui.q('#account-panel').getAttribute('aria-labelledby'),'tab-register');
  ui.q('#password').value='password123';
  ui.click('[data-target="password"]'); assert.equal(ui.q('#password').type,'text');
  ui.click('#tab-login');
  assert.equal(ui.q('#password').value,'');
  assert.equal(ui.q('#password').type,'password');
  assert.equal(ui.q('#confirm-field').hidden,true);
});
test('invalid fields stop submission; an absent account service never fakes success',async()=>{
  const ui=setup(); ui.q('#email').value='invalid'; ui.submit();
  assert.equal(ui.q('#email').getAttribute('aria-invalid'),'true');
  assert.equal(ui.q('#password').getAttribute('aria-invalid'),'true');
  ui.q('#email').value='user@institute.edu'; ui.q('#password').value='abc12345';
  ui.submit(); await ui.tick();
  assert.equal(ui.q('#form-status').dataset.kind,'error');
  assert.match(ui.q('#form-status').textContent,/无法连接账号服务/);
  assert.equal(ui.q('#submit-button').disabled,false);
  assert.equal(ui.saved.has('lexivault.email'),false);
});
test('a connected sign-in adapter receives credentials, while storage and events exclude passwords',async()=>{
  let payload; const ui=setup({signIn:async input=>{payload=input; return {redirectTo:'/workspace'};}});
  let detail; ui.document.addEventListener('lexivault:authenticated',event=>{detail=event.detail;});
  ui.q('#email').value=' user@institute.edu '; ui.q('#password').value='secret123';
  ui.submit(); await ui.tick();
  assert.equal(payload.email,'user@institute.edu'); assert.equal(payload.password,'secret123');
  assert.equal(ui.q('#password').value,'');
  assert.equal(ui.saved.get('lexivault.email'),'user@institute.edu');
  assert.deepEqual(Object.keys(detail).sort(),['email','mode']);
  assert.equal([...ui.saved.keys()].some(key=>/password|token/.test(key)),false);
  assert.deepEqual(ui.navigation,['https://lexivault.example/workspace']);
});
test('registration confirms passwords and returns to login only after adapter success',async()=>{
  let requests=0; const ui=setup({signUp:async()=>{requests++;}});
  ui.click('#tab-register'); ui.q('#email').value='user@institute.edu'; ui.q('#password').value='secret123'; ui.q('#confirm-password').value='different';
  ui.submit(); assert.equal(requests,0); assert.equal(ui.q('#confirm-error').hidden,false);
  ui.q('#confirm-password').value='secret123'; ui.submit(); await ui.tick();
  assert.equal(requests,1); assert.equal(ui.q('#tab-login').getAttribute('aria-selected'),'true');
  assert.equal(ui.q('#form-status').dataset.kind,'success'); assert.match(ui.q('#form-status').textContent,/请登录/);
});
test('forgot-password dialog validates email and reports actual adapter completion',async()=>{
  let requested; const ui=setup({requestPasswordReset:async({email})=>{requested=email;}});
  ui.q('#email').value='user@institute.edu'; ui.click('#forgot-password');
  assert.equal(ui.q('#reset-dialog').hasAttribute('open'),true);
  assert.equal(ui.q('#reset-email').value,'user@institute.edu');
  ui.q('#reset-form').dispatchEvent(new ui.window.Event('submit',{bubbles:true,cancelable:true})); await ui.tick();
  assert.equal(requested,'user@institute.edu'); assert.equal(ui.q('#reset-status').dataset.kind,'success');
});
test('local folder selection passes a handle without reading or uploading files',async()=>{
  const ui=setup(); let selected;
  ui.window.showDirectoryPicker=async()=>({name:'My Research',getFile:()=>{throw new Error('must not read files');}});
  ui.document.addEventListener('lexivault:vault-selected',event=>{selected=event.detail;});
  ui.click('#open-vault'); await ui.tick();
  assert.equal(selected.name,'My Research'); assert.equal(ui.q('#vault-name').textContent,'My Research');
  assert.equal(ui.q('#vault-dialog').hasAttribute('open'),true);
});
test('successful sign-in enters the new homepage by default',async()=>{
  const ui=setup({signIn:async()=>({})});
  ui.q('#email').value='user@institute.edu';ui.q('#password').value='secret123';
  ui.submit();await ui.tick();
  assert.deepEqual(ui.navigation,['https://lexivault.example/home.html']);
});
test('a selected local vault enters the homepage and carries its workspace name',async()=>{
  const ui=setup();ui.window.showDirectoryPicker=async()=>({name:'Research Vault'});
  ui.click('#open-vault');await ui.tick();ui.click('#vault-enter');
  assert.equal(ui.sessionSaved.get('lexivault.vault-name'),'Research Vault');
  assert.deepEqual(ui.navigation,['https://lexivault.example/home.html']);
});
