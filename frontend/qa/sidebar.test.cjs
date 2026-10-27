const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom');
const root=path.join(__dirname,'../dist'),code=fs.readFileSync(path.join(root,'sidebar.js'),'utf8');
const modeKey='lexivault.sidebar.mode';
function setup(t,page='home',{saved={},width=1500,blocked=false,again=false}={}){
 const dom=new JSDOM(fs.readFileSync(path.join(root,page+'.html'),'utf8'),{url:'https://example.test/'+page+'.html',runScripts:'outside-only',pretendToBeVisual:true});
 const w=dom.window,d=w.document;Object.defineProperty(w,'innerWidth',{value:width,writable:true,configurable:true});
 Object.entries(saved).forEach(([k,v])=>w.localStorage.setItem(k,v));
 if(blocked){w.Storage.prototype.getItem=function(){throw new Error('storage unavailable');};w.Storage.prototype.setItem=function(){throw new Error('storage unavailable');};}
 for(const script of d.querySelectorAll('head script:not([src])'))w.eval(script.textContent);
 // Exercise the actual common style after each page's existing style, as in production.
 for(const link of d.querySelectorAll('link[rel=stylesheet]')){const style=d.createElement('style');style.textContent=fs.readFileSync(path.join(root,link.getAttribute('href').split('?')[0]),'utf8');link.replaceWith(style);}
 // JSDOM does not apply viewport media queries; expose the real mobile trigger for focus testing.
 if(width<=760)d.getElementById("nav-open").style.display="inline-grid";
 w.eval(code);if(again)w.eval(code);
 t.after(()=>w.close());return {w,d,dom,q:s=>d.querySelector(s),click:s=>d.querySelector(s).click(),api:w.LexiVaultSidebar};
}
test('all six routes retain identical canonical SVGs, order, row spacing and icon column',t=>{
 let reference;
 for(const route of ['home','discover','reader','plans','graph','knowledge']){
  const ui=setup(t,route),links=[...ui.d.querySelectorAll('.lv-nav-link')];
  assert.equal(links.length,6);assert.equal(ui.q('#collapse-sidebar'),null);
  const geometry=links.map(link=>({id:link.dataset.feature,svg:link.querySelector('svg').outerHTML,height:ui.w.getComputedStyle(link).height,columns:ui.w.getComputedStyle(link).gridTemplateColumns}));
  const allIcons=[...ui.d.querySelectorAll('#sidebar svg')].map(svg=>({svg:svg.outerHTML,width:ui.w.getComputedStyle(svg).width,height:ui.w.getComputedStyle(svg).height}));
  const result={geometry,allIcons,gap:ui.w.getComputedStyle(ui.q('.lv-navigation')).gap};
  if(reference)assert.deepEqual(result,reference);else reference=result;
  assert.equal(ui.q('.lv-nav-link.is-active').dataset.feature,route==='home'?'assistant':route);
  assert.equal(ui.q('.lv-nav-link[data-feature=knowledge] svg').innerHTML,'<path d="M3 3h18v4H3Zm0 7h18v4H3Zm0 7h18v4H3Z"></path>');
  assert.equal(ui.q('.lv-nav-link[data-feature=reader] svg ellipse').getAttribute('rx'),'8');
 }
});
test('the whole blank column expands and collapses without moving the icon grid',t=>{
 const ui=setup(t,'plans'),link=ui.q('.lv-nav-link'),geometry=()=>[ui.w.getComputedStyle(link).height,ui.w.getComputedStyle(link).gridTemplateColumns];const before=geometry();
 assert.equal(ui.w.getComputedStyle(link.querySelector('.lv-label')).display,'none');
 ui.click('#sidebar-surface');assert.equal(ui.d.documentElement.dataset.sidebar,'expanded');assert.equal(ui.q('#sidebar-surface').getAttribute('aria-expanded'),'true');assert.equal(ui.w.getComputedStyle(link.querySelector('.lv-label')).display,'block');assert.deepEqual(geometry(),before);
 ui.click('.lv-sidebar-middle');assert.equal(ui.d.documentElement.dataset.sidebar,'compact');assert.equal(ui.q('#sidebar-surface').getAttribute('aria-expanded'),'false');
 ui.click('#sidebar');assert.equal(ui.api.mode,'expanded');
});
test('navigation, appearance and account controls keep their own action instead of collapsing the column',t=>{
 const ui=setup(t,'knowledge',{saved:{[modeKey]:'expanded'}});let route;
 ui.d.addEventListener('lexivault:navigate',e=>{route=e.detail;e.preventDefault();});
 ui.click('[data-feature=reader]');assert.equal(route.href,'reader.html');assert.equal(ui.api.mode,'expanded');
 ui.click('#theme-dark');assert.equal(ui.d.documentElement.dataset.theme,'dark');assert.equal(ui.api.mode,'expanded');
 ui.click('#account-button');assert.equal(ui.q('#account-menu').hidden,false);assert.equal(ui.api.mode,'expanded');
 ui.click('#workspace-selector');assert.equal(ui.q('#workspace-menu').hidden,false);assert.equal(ui.api.mode,'expanded');
});
test('theme control adapts to sidebar width while preserving selection, compact toggle and persisted theme',t=>{
 const ui=setup(t,'knowledge',{saved:{'lexivault.theme':'dark'}}),style=s=>ui.w.getComputedStyle(ui.q(s));
 assert.equal(style('#theme-compact').display,'grid');assert.equal(style('.lv-theme-switch').display,'none');
 assert.equal(style('.lv-theme-sun').display,'none');assert.equal(style('.lv-theme-moon').display,'block');
 assert.equal(ui.q('#theme-compact').getAttribute('aria-checked'),'true');assert.equal(ui.q('#theme-compact').title,'切换到日间模式');
 ui.click('#sidebar-surface');assert.equal(style('#theme-compact').display,'none');assert.equal(style('.lv-theme-switch').display,'flex');
 assert.equal(ui.q('#theme-light span').textContent,'日间');assert.equal(ui.q('#theme-dark span').textContent,'夜间');
 assert.equal(ui.d.documentElement.dataset.theme,'dark');assert.equal(ui.q('#theme-dark').getAttribute('aria-pressed'),'true');
 ui.click('#theme-light');assert.equal(ui.api.mode,'expanded');assert.equal(ui.q('#theme-light').getAttribute('aria-pressed'),'true');
 ui.click('#sidebar-surface');assert.equal(ui.d.documentElement.dataset.theme,'light');assert.equal(style('.lv-theme-moon').display,'none');assert.notEqual(style('.lv-theme-sun').display,'none');
 assert.equal(ui.q('#theme-compact').getAttribute('aria-checked'),'false');assert.equal(ui.q('#theme-compact').title,'切换到夜间模式');
 ui.click('#theme-compact');assert.equal(ui.api.mode,'compact');assert.equal(ui.d.documentElement.dataset.theme,'dark');assert.equal(ui.q('#theme-dark').getAttribute('aria-pressed'),'true');
 const next=setup(t,'plans',{saved:{[modeKey]:ui.api.mode,'lexivault.theme':ui.w.localStorage.getItem('lexivault.theme')}});
 assert.equal(next.api.mode,'compact');assert.equal(next.q('#theme-compact').getAttribute('aria-checked'),'true');
 next.click('#sidebar-surface');assert.equal(next.q('#theme-dark').getAttribute('aria-pressed'),'true');
});
test('switching pages restores the saved width before the shared controller initializes',t=>{
 const first=setup(t,'home');first.click('#sidebar-surface');assert.equal(first.w.localStorage.getItem(modeKey),'expanded');
 const next=setup(t,'reader',{saved:{[modeKey]:first.w.localStorage.getItem(modeKey)}});assert.equal(next.api.mode,'expanded');next.click('#sidebar-surface');
 const third=setup(t,'discover',{saved:{[modeKey]:next.w.localStorage.getItem(modeKey)}});assert.equal(third.api.mode,'compact');
});
test('storage updates and back-forward restoration synchronize the persisted mode',t=>{
 const ui=setup(t,'graph');ui.w.localStorage.setItem(modeKey,'expanded');ui.w.dispatchEvent(new ui.w.StorageEvent('storage',{key:modeKey,newValue:'expanded'}));assert.equal(ui.api.mode,'expanded');
 ui.w.localStorage.setItem(modeKey,'compact');ui.w.dispatchEvent(new ui.w.Event('pageshow'));assert.equal(ui.api.mode,'compact');assert.equal(ui.q('#sidebar-surface').getAttribute('aria-expanded'),'false');
});
test('mobile drawer keeps labels and restores desktop mode without treating touch space as a toggle',t=>{
 const ui=setup(t,'plans',{width:390,saved:{[modeKey]:'expanded'}});
 assert.equal(ui.q('#sidebar').hasAttribute('inert'),true);assert.equal(ui.q('#sidebar-surface').disabled,true);
 ui.click('#nav-open');assert.equal(ui.q('#sidebar').hasAttribute('inert'),false);assert.equal(ui.q('[data-sidebar-main]').hasAttribute('inert'),true);
 ui.click('.lv-sidebar-middle');assert.equal(ui.api.mode,'expanded');assert.equal(ui.api.mobileOpen,true);
 ui.click('#sidebar-scrim');assert.equal(ui.api.mobileOpen,false);assert.equal(ui.d.activeElement.id,'nav-open');
 ui.w.innerWidth=1500;ui.w.dispatchEvent(new ui.w.Event('resize'));assert.equal(ui.api.mode,'expanded');assert.equal(ui.q('#sidebar-surface').disabled,false);
});
test('blocked storage still permits toggling and initializing twice does not duplicate click handlers',t=>{
 const ui=setup(t,'discover',{blocked:true,again:true});assert.equal(ui.api.mode,'compact');ui.click('#sidebar-surface');assert.equal(ui.api.mode,'expanded');ui.click('#sidebar-surface');assert.equal(ui.api.mode,'compact');
});
