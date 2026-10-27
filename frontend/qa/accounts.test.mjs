import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';

const script = fs.readFileSync(new URL('../src/account-client.js',import.meta.url),'utf8');

async function until(predicate) {
  for (let i=0;i<100;i++) { if(predicate()) return; await new Promise(resolve=>setTimeout(resolve,5)); }
  assert.fail('Account UI did not finish');
}

function fixture(t) {
  const dom = new JSDOM('<button id="account-button"><span class="lv-avatar"></span><span class="lv-account-copy"></span></button><div id="account-menu"></div>',{url:'http://localhost/reader.html',runScripts:'outside-only'});
  t.after(()=>dom.window.close());
  const w=dom.window, calls=[];
  let logged=false, lastSettings={theme:'dark',font_size:18};
  w.fetch=async(url,options={})=>{
    calls.push({url,options});
    let data;
    if(url==='/api/session') data={token:'local-csrf-token'};
    else if(url==='/api/auth/register') data={user:{id:'user'}};
    else if(url==='/api/auth/login') { logged=true; data={user:{id:'user'},csrf_token:'account-csrf-token'}; }
    else if(url==='/api/auth/logout') { logged=false; data={signed_out:true}; }
    else if(url==='/api/auth/me') data=logged?{user:{id:'user',email:'student@example.com',nickname:'<img src=x>'},csrf_token:'account-csrf-token',settings:lastSettings}:{user:null};
    else if(url==='/api/auth/settings') { lastSettings={...lastSettings,...JSON.parse(options.body)}; data=lastSettings; }
    else if(url==='/api/auth/password-reset') return {ok:false,status:503,async json(){return {code:'resetUnavailable',message:'邮件尚未配置'};}};
    else throw new Error('Unexpected '+url);
    return {ok:true,status:200,async json(){return data;}};
  };
  w.eval(script);
  return {w,calls};
}

test('account adapter sends only credentials to same-origin endpoints and never persists secrets',async t=>{
  const {w,calls}=fixture(t);
  await w.lexivaultAuth.signUp({email:'student@example.com',password:'TestingPassword2026',signal:undefined});
  const result=await w.lexivaultAuth.signIn({email:'student@example.com',password:'TestingPassword2026',remember:true,untrusted:'extra'});
  assert.equal(result.redirectTo,'./home.html');
  const login=calls.find(call=>call.url==='/api/auth/login');
  assert.deepEqual(JSON.parse(login.options.body),{email:'student@example.com',password:'TestingPassword2026',remember:true});
  assert.equal(login.options.headers['X-LexiVault-Token'],'local-csrf-token');
  assert.equal(login.options.credentials,'same-origin');
  const storage=JSON.stringify({...w.localStorage,...w.sessionStorage});
  assert.doesNotMatch(storage,/TestingPassword2026|local-csrf-token|account-csrf-token/);
  assert.ok(calls.every(call=>call.url.startsWith('/api/')));
});

test('account menu safely displays the real identity, restores preferences and logs out with CSRF',async t=>{
  const {w,calls}=fixture(t);
  await w.lexivaultAuth.signIn({email:'student@example.com',password:'TestingPassword2026'});
  w.document.dispatchEvent(new w.CustomEvent('lexivault:authenticated'));
  await until(()=>!!w.document.querySelector('#account-menu button'));
  assert.equal(w.document.querySelector('#account-button img'),null);
  assert.match(w.document.querySelector('#account-button').textContent,/<img src=x>/);
  assert.equal(w.document.documentElement.dataset.theme,'dark');
  assert.equal(w.document.documentElement.style.getPropertyValue('--reader-note-font-size'),'18px');
  await w.lexivaultAuth.signOut();
  assert.equal(calls.find(call=>call.url==='/api/auth/logout').options.headers['X-Account-CSRF'],'account-csrf-token');
  assert.match(w.document.querySelector('#account-menu').textContent,/未登录/);
  await assert.rejects(()=>w.lexivaultAuth.requestPasswordReset({email:'student@example.com'}),error=>error.code==='resetUnavailable');
});
