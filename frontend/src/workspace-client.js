// Shared local workspace picker. Every feature reads the same server selection.
(() => {
  let current=null,token='',available=false,spaces=[],dataDir='',busy=false,listRequest=null;
  const guards=new Set();
  const menu=document.getElementById('workspace-menu'),trigger=document.getElementById('workspace-selector');
  async function request(path,options={}){
    const response=await fetch(path,{credentials:'same-origin',...options,headers:{...(options.body instanceof FormData?{}:{'Content-Type':'application/json'}),'X-LexiVault-Token':token,...options.headers}});
    const data=await response.json();
    if(!response.ok)throw Object.assign(new Error(data.message||'工作空间操作失败。'),{status:response.status});
    return data;
  }
  function status(message=''){
    const node=document.getElementById('workspace-menu-status');
    if(node){node.hidden=!message;node.textContent=message;}
  }
  function closeMenu(){if(menu)menu.hidden=true;trigger?.setAttribute('aria-expanded','false');}
  function positionMenu(){
    if(!menu || menu.hidden || !trigger)return;
    if(typeof menu.showPopover!=='function')return;
    if(!menu.matches(':popover-open'))menu.showPopover();
    const box=trigger.getBoundingClientRect(),width=Math.min(240,window.innerWidth-24);
    menu.style.width=width+'px';menu.style.maxHeight=Math.max(120,window.innerHeight-24)+'px';
    const height=menu.getBoundingClientRect().height;
    const top=box.bottom+6+height<=window.innerHeight-12?box.bottom+6:Math.max(12,box.top-height-6);
    menu.style.left=Math.max(12,Math.min(box.left,window.innerWidth-width-12))+'px';menu.style.top=top+'px';
  }
  if(menu && typeof menu.showPopover==='function'){
    menu.setAttribute('popover','manual');
    new MutationObserver(()=>{if(menu.hidden){if(menu.matches(':popover-open'))menu.hidePopover();}else positionMenu();}).observe(menu,{attributes:true,attributeFilter:['hidden']});
    window.addEventListener('resize',positionMenu);
    document.addEventListener('scroll',event=>{if(!menu.contains(event.target))positionMenu();},true);
  }
  function renderMenu(){
    const list=document.getElementById('workspace-list');if(!list)return;
    const focused=list.contains(document.activeElement)?document.activeElement.dataset.workspaceId:null;
    list.replaceChildren();
    const ordered=[...spaces].sort((a,b)=>Number(b.id===current?.id)-Number(a.id===current?.id)||a.name.localeCompare(b.name,'zh-CN'));
    for(const space of ordered){
      const button=document.createElement('button');button.type='button';button.dataset.workspaceId=space.id;button.disabled=busy;
      button.className='lv-space-option';button.title=space.path||space.name;button.setAttribute('aria-pressed',String(space.id===current?.id));
      const name=document.createElement('span');name.textContent=space.name;button.append(name);
      if(space.id===current?.id){const badge=document.createElement('small');badge.textContent='当前';button.append(badge);}
      list.append(button);if(focused===space.id)button.focus();
    }
    if(!ordered.length){const empty=document.createElement('p');empty.textContent=available?'还没有工作空间':'请先启动本地服务';list.append(empty);}
    const create=document.getElementById('new-workspace');if(create)create.disabled=busy||!available;
    positionMenu();
  }
  function paint(){
    document.querySelectorAll('[data-workspace-name]').forEach(node=>node.textContent=current?.name||'选择工作空间');
    renderMenu();
  }
  async function refreshSpaces(){
    if(!available)return;
    if(listRequest)return listRequest;
    listRequest=(async()=>{try{const result=await request('/api/workspaces');if(!Array.isArray(result))throw new Error('工作空间列表无法读取，请重试。');spaces=result;renderMenu();status();}catch(error){status(error.message);}finally{listRequest=null;}})();
    return listRequest;
  }
  async function history(){
    if(document.body.dataset.feature==='assistant'||document.getElementById('workspace-shell'))return;
    const list=document.getElementById('history-list');if(!list)return;
    list.replaceChildren();if(!current)return;
    const data=await request(`/api/workspaces/${current.id}/assistant`);
    for(const chat of data.state.conversations||[]){const link=document.createElement('a');link.className='lv-history-link';link.textContent=chat.title;link.href='home.html?chat='+encodeURIComponent(chat.id);list.append(link);}
    if(!list.childElementCount){const empty=document.createElement('p');empty.className='lv-history-empty';empty.textContent='还没有对话';list.append(empty);}
  }
  async function canSwitch(){for(const guard of guards)if(!await guard())return false;return true;}
  async function select(space){
    current=space;if(space&&!spaces.some(item=>item.id===space.id))spaces.push(space);
    paint();await history().catch(()=>{});window.dispatchEvent(new CustomEvent('lexivault:workspace-changed',{detail:space}));
  }
  function notifyOtherPages(){try{localStorage.setItem('lexivault.active-workspace.changed',Date.now()+':'+current.id);}catch{}}
  function navigate(){window.location.assign(window.location.pathname);}
  async function change(action,shouldNavigate){
    if(busy)return null;busy=true;renderMenu();status();
    try{
      if(!await canSwitch()){status('当前内容尚未处理，请先保存或处理页面中的提示。');return null;}
      const space=await action();await select(space);notifyOtherPages();closeMenu();if(shouldNavigate)navigate();return space;
    }finally{busy=false;renderMenu();}
  }
  async function switchTo(id,{navigate:shouldNavigate=true}={}){
    await ready;if(id===current?.id){closeMenu();return current;}
    return change(()=>request(`/api/workspaces/${encodeURIComponent(id)}/open`,{method:'POST'}),shouldNavigate);
  }
  async function create(name,{navigate:shouldNavigate=true}={}){
    await ready;name=name.trim();if(!name||name.length>80)throw new Error('请输入 1 至 80 个字符的工作空间名称。');
    return change(()=>request('/api/workspaces',{method:'POST',body:JSON.stringify({name})}),shouldNavigate);
  }
  // Build the same dialog for homepage, reader, plans, and the other routes.
  let dialog,form,nameInput,dialogStatus,submit;
  if(menu){
    dialog=document.createElement('dialog');dialog.className='lv-space-dialog';dialog.id='sidebar-workspace-dialog';dialog.setAttribute('aria-labelledby','sidebar-space-title');
    dialog.innerHTML='<form id="sidebar-space-form"><div class="lv-space-dialog-heading"><h2 id="sidebar-space-title">新建工作空间</h2><button type="button" id="sidebar-space-close" aria-label="关闭新建工作空间">×</button></div><label for="sidebar-space-name">工作空间名称</label><input id="sidebar-space-name" maxlength="80" required autocomplete="off" placeholder="例如：我的毕业课题"><p id="sidebar-space-location"></p><p id="sidebar-space-error" role="alert" hidden></p><div class="lv-space-dialog-actions"><button type="button" id="sidebar-space-cancel">取消</button><button type="submit" id="sidebar-space-submit">创建并打开</button></div></form>';
    document.body.append(dialog);form=dialog.querySelector('form');nameInput=dialog.querySelector('input');dialogStatus=dialog.querySelector('#sidebar-space-error');submit=dialog.querySelector('[type=submit]');
    function closeDialog(){if(!busy)dialog.close();}
    dialog.querySelector('#sidebar-space-close').addEventListener('click',closeDialog);dialog.querySelector('#sidebar-space-cancel').addEventListener('click',closeDialog);
    dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
    form.addEventListener('submit',async event=>{
      event.preventDefault();if(busy||!form.reportValidity())return;
      dialogStatus.hidden=true;submit.disabled=true;nameInput.disabled=true;
      try{const space=await create(nameInput.value);if(space)dialog.close();else{dialogStatus.textContent='当前页面还有未保存内容，请先处理后再创建。';dialogStatus.hidden=false;}}
      catch(error){dialogStatus.textContent=error.message;dialogStatus.hidden=false;}
      finally{submit.disabled=false;nameInput.disabled=false;}
    });
    menu.addEventListener('click',async event=>{
      const item=event.target.closest('[data-workspace-id]');
      if(item){try{await switchTo(item.dataset.workspaceId);}catch(error){status(error.message);}return;}
      if(event.target.closest('#new-workspace')){
        closeMenu();nameInput.value='';dialogStatus.hidden=true;
        dialog.querySelector('#sidebar-space-location').textContent=dataDir?`本地保存目录：${dataDir}\\workspaces；创建后自动打开。`:'创建后自动打开新的工作空间。';
        dialog.showModal();nameInput.focus();
      }
    });
    trigger?.addEventListener('click',()=>queueMicrotask(()=>{if(!menu.hidden)void refreshSpaces();}));
    menu.addEventListener('keydown',event=>{
      if(!['ArrowDown','ArrowUp'].includes(event.key))return;
      const buttons=[...menu.querySelectorAll('button:not(:disabled)')],index=buttons.indexOf(document.activeElement);if(!buttons.length)return;
      event.preventDefault();event.stopPropagation();buttons[(index+(event.key==='ArrowDown'?1:buttons.length-1)+buttons.length)%buttons.length].focus();
    });
  }
  const ready=(async()=>{
    try{const session=await request('/api/session');token=session.token;dataDir=session.data_dir||'';current=await request('/api/workspace/current');available=true;}
    catch{ /* Static previews have no local workspace service. */ }
    if(current)spaces=[current];paint();await refreshSpaces();await history().catch(()=>{});return current;
  })();
  window.LexiVaultSpace={ready,request,select,switchTo,create,refresh:refreshSpaces,addSwitchGuard(guard){guards.add(guard);return()=>guards.delete(guard);},get current(){return current;},get available(){return available;},get directory(){try{return localStorage.getItem('lexivault.directory.'+current?.id)||'';}catch{return '';}},set directory(value){try{localStorage.setItem('lexivault.directory.'+current?.id,value);}catch{}}};
  window.addEventListener('storage',async event=>{
    if(event.key!=='lexivault.active-workspace.changed')return;
    try{if(await canSwitch())navigate();else status('其他页面已切换工作空间，请先处理当前未保存内容后刷新。');}catch(error){status(error.message);}
  });
})();
