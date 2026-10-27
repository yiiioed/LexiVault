import {icon} from './suite.js';
export function mountExplorer(container,{client,space,onOpen=()=>{},onChange=()=>{},beforeChange=async()=>true}={}){
  let entries=[],selected=client.directory || '',closed=false,refreshing=false,filter='',serial=0;
  const root=document.createElement('section');root.className='vault-explorer';container.append(root);
  const toolbar=document.createElement('div');toolbar.className='vault-tools';
  const tree=document.createElement('div');tree.className='vault-tree';tree.setAttribute('role','tree');tree.setAttribute('aria-label','工作空间文件树');
  const location=document.createElement('p');location.className='vault-location';
  const feedback=document.createElement('p');feedback.className='vault-status';feedback.setAttribute('role','status');
  const dialog=document.createElement('dialog');dialog.className='s-dialog vault-dialog';document.body.append(dialog);
  const picker=document.createElement('input');picker.type='file';picker.multiple=true;picker.hidden=true;
  function button(label,glyph,fn){const b=document.createElement('button');b.type='button';b.title=label;b.setAttribute('aria-label',label);if(glyph)b.innerHTML=icon(glyph);else b.textContent=label;b.addEventListener('click',()=>Promise.resolve(fn()).catch(error=>message(error.message,true)));return b;}
  function message(text,error=false){feedback.textContent=text;feedback.classList.toggle('is-error',error);}
  function select(path){selected=path;client.directory=path;location.textContent='保存位置：'+(path || '工作空间根目录');render();}
  async function mutation(fn){if(!await beforeChange())return;await fn();serial++;await refresh();await onChange();}
  function show(title,build){dialog.replaceChildren();const h=document.createElement('h2');h.textContent=title;const close=button('关闭','close',()=>dialog.close());const head=document.createElement('div');head.className='dialog-heading';head.append(h,close);dialog.append(head);build(dialog);dialog.showModal();}
  function formField(parent,label,value=''){const id='vault-field-'+Math.random().toString(36).slice(2),l=document.createElement('label');l.htmlFor=id;l.textContent=label;const input=document.createElement('input');input.id=id;input.value=value;input.maxLength=200;parent.append(l,input);return input;}
  function folderSelect(parent,labelText,value=selected){const label=document.createElement('label'),select=document.createElement('select');label.textContent=labelText;select.id='vault-folder-'+Math.random().toString(36).slice(2);label.htmlFor=select.id;select.add(new Option('工作空间根目录',''));entries.filter(e=>e.kind==='folder').forEach(e=>select.add(new Option(e.path,e.path)));select.value=value;parent.append(label,select);return select;}
  function create(kind){show(kind==='folder'?'新建文件夹':'新建笔记',body=>{const folder=folderSelect(body,'创建位置'),name=formField(body,kind==='folder'?'文件夹名称':'文件名',kind==='folder'?'':'未命名笔记.md');const createButton=button('创建',null,async()=>{let filename=name.value.trim();if(kind==='markdown'&&!filename.toLowerCase().endsWith('.md'))filename+='.md';await mutation(async()=>{const result=await client.request(base,{method:'POST',body:JSON.stringify({parent:folder.value,name:filename,kind})});dialog.close();select(folder.value);await refresh();if(kind==='markdown'){const entry=entries.find(e=>e.path===result.path);if(entry){await onChange();await onOpen(entry);}}});});body.append(createButton);});}
  const base=`/api/workspaces/${space.id}/files`;
  function actions(entry){show('文件操作：'+entry.name,body=>{
    const name=formField(body,'重命名',entry.name);body.append(button('保存名称',null,()=>mutation(async()=>{const parent=entry.path.split('/').slice(0,-1).join('/'),destination=[parent,name.value.trim()].filter(Boolean).join('/');await client.request(base+'/move',{method:'POST',body:JSON.stringify({source:entry.path,destination})});dialog.close();})));
    const folder=folderSelect(body,'移动到',entry.path.split('/').slice(0,-1).join('/'));
    body.append(button('移动',null,()=>mutation(async()=>{await client.request(base+'/move',{method:'POST',body:JSON.stringify({source:entry.path,destination:[folder.value,entry.name].filter(Boolean).join('/')})});dialog.close();})),button('删除',null,async()=>{if(!window.confirm(`删除“${entry.name}”？${entry.kind==='folder'?'其中所有文件也会一起删除。':''}可在电脑系统回收站恢复。`))return;await mutation(async()=>{await client.request(base+'/delete',{method:'POST',body:JSON.stringify({path:entry.path})});dialog.close();message('已删除，可在电脑系统回收站恢复。');});}));
  });}
  async function upload(files){if(!files.length)return;await mutation(async()=>{const form=new FormData();form.append('directory',selected);for(const file of files)form.append('files',file,file.name);await client.request(base+'/upload',{method:'POST',body:form});message('已保存到 '+(selected || '工作空间根目录'));});}
  picker.addEventListener('change',()=>void upload([...picker.files]).catch(error=>message(error.message,true)).finally(()=>picker.value=''));
  toolbar.append(button('新建笔记','plan',()=>create('markdown')),button('新建文件夹','folder',()=>create('folder')),button('导入文件','upload',()=>picker.click()),button('刷新文件树','redo',()=>refresh()));
  const rootButton=button(space.name,'folder',()=>select(''));const rootName=document.createElement('span');rootName.textContent=space.name;rootButton.append(rootName);rootButton.classList.add('vault-root');root.append(toolbar,rootButton,location,tree,feedback,picker);
  function render(){
    const open=new Set([...tree.querySelectorAll('details[open]')].map(d=>d.dataset.path));tree.replaceChildren();
    const term=filter.trim().toLowerCase();
    function children(parent,node){
      for(const entry of entries.filter(e=>e.path.split('/').slice(0,-1).join('/')===parent)){
        if(term && !entry.path.toLowerCase().includes(term) && !(entry.kind==='folder' && entries.some(e=>e.path.startsWith(entry.path+'/')&&e.path.toLowerCase().includes(term))))continue;
        const row=document.createElement('div');row.className='vault-row';row.dataset.path=entry.path;
        const label=button(entry.name,entry.kind==='folder'?'folder':entry.kind==='pdf'?'read':'plan',async()=>{
          if(entry.kind==='folder'){select(entry.path);return;}
          select(entry.path.split('/').slice(0,-1).join('/'));await onOpen(entry);
        });
        const text=document.createElement('span');text.textContent=entry.name;label.append(text);label.classList.add('vault-entry');label.title=entry.path;
        if(entry.kind==='folder' && selected===entry.path)row.classList.add('is-selected');
        row.append(label,button('操作 '+entry.name,'more',()=>actions(entry)));row.draggable=true;
        row.addEventListener('dragstart',event=>{event.stopPropagation();event.dataTransfer.setData('application/x-lexivault-path',entry.path);event.dataTransfer.effectAllowed='move';});
        if(entry.kind==='folder'){
          const details=document.createElement('details');details.dataset.path=entry.path;details.open=!!term || open.has(entry.path) || selected===entry.path || selected.startsWith(entry.path+'/');const summary=document.createElement('summary');summary.setAttribute('role','treeitem');summary.setAttribute('aria-label',entry.name+' 文件夹');summary.append(row);details.append(summary);children(entry.path,details);dropTarget(row,entry.path);node.append(details);
        }else {row.setAttribute('role','treeitem');node.append(row);}
      }
    }
    children('',tree);
    if(!tree.childElementCount){const p=document.createElement('p');p.className='empty-hint';p.textContent=term?'没有匹配的文件':'文件夹为空。新建笔记、文件夹，或导入论文。';tree.append(p);}
    location.textContent='保存位置：'+(selected || '工作空间根目录');
  }
  function dropTarget(target,directory){target.addEventListener('dragover',event=>{event.preventDefault();event.stopPropagation();target.classList.add('is-drop-target');});target.addEventListener('dragleave',()=>target.classList.remove('is-drop-target'));target.addEventListener('drop',event=>{event.preventDefault();event.stopPropagation();target.classList.remove('is-drop-target');const destinationFolder=typeof directory==='function'?directory():directory;const source=event.dataTransfer.getData('application/x-lexivault-path');if(source){const name=source.split('/').pop();void mutation(()=>client.request(base+'/move',{method:'POST',body:JSON.stringify({source,destination:[destinationFolder,name].filter(Boolean).join('/')})})).catch(error=>message(error.message,true));}else{select(destinationFolder);void upload([...event.dataTransfer.files]).catch(error=>message(error.message,true));}});}
  dropTarget(rootButton,'');dropTarget(tree,()=>selected);
  async function refresh(){if(closed || refreshing)return;refreshing=true;try{const data=await client.request(base);if(closed)return;entries=data.entries || [];if(selected && !entries.some(e=>e.kind==='folder'&&e.path===selected))selected='';client.directory=selected;render();if(data.warnings?.length)message(data.warnings.map(w=>w.path+': '+w.message).join('；'),true);else if(feedback.classList.contains('is-error'))message('');}catch(error){message(error.message,true);}finally{refreshing=false;}}
  const timer=setInterval(()=>void refresh(),3000);void refresh();
  return {refresh,get entries(){return entries;},get directory(){return selected;},search(value){filter=value;render();},destroy(){closed=true;clearInterval(timer);dialog.remove();root.remove();}};
}
