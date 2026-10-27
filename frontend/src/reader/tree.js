import {icon} from '../suite.js';

// Real folder hierarchy; expansion survives the reader's file polling.
export function renderPaperTree(target,{entries=[],documents=[],query='',activeId=null,activePath='',expanded=new Set(),selectedFolder='',onOpen=()=>{},onFolder=()=>{},onToggle=()=>{},onTrash=null}={}){
  const focused=target.contains(document.activeElement)?document.activeElement.dataset.paperPath:null;
  const focusedDelete=document.activeElement?.classList.contains('reader-entry-delete');
  target.replaceChildren();const term=query.trim().toLocaleLowerCase(),byId=new Map(documents.map(d=>[d.id,d]));
  const relevant=entries.filter(e=>e.kind==='folder'||e.kind==='pdf');
  const parent=path=>path.split('/').slice(0,-1).join('/');
  const matches=entry=>[entry.path,byId.get(entry.document_id)?.title||''].join(' ').toLocaleLowerCase().includes(term);
  const visible=entry=>!term||matches(entry)||(entry.kind==='folder'&&relevant.some(e=>e.path.startsWith(entry.path+'/')&&matches(e)));
  const represented=new Set(entries.filter(e=>e.kind==='pdf').map(e=>e.document_id));
  const sorted=[...relevant].sort((a,b)=>Number(b.kind==='folder')-Number(a.kind==='folder')||a.name.localeCompare(b.name,'zh-CN',{numeric:true}));
  function trashButton(entry){
    if(!onTrash || entry.path.startsWith('document:'))return null;
    const button=document.createElement('button');button.type='button';button.className='reader-entry-delete';button.dataset.paperPath=entry.path;
    button.title='删除（移入系统回收站）';button.setAttribute('aria-label','删除 '+entry.name);button.innerHTML=icon('trash');
    button.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();onTrash(entry.path);});
    return button;
  }
  function paper(entry,node){
    const doc=byId.get(entry.document_id),button=document.createElement('button');button.type='button';button.className='reader-document';button.dataset.paperPath=entry.path;
    button.setAttribute('aria-current',String(activePath?entry.path===activePath:activeId===doc?.id));
    button.innerHTML=icon('plan');const name=document.createElement('span');name.textContent=entry.name;button.append(name);
    button.title=entry.path+(doc?.title?'\n'+doc.title:'');button.disabled=!doc;
    if(!doc)button.title+='\n暂无法识别此 PDF，请检查文件后刷新。';
    else button.addEventListener('click',()=>onOpen(doc,entry.path));
    const row=document.createElement('div');row.className='reader-document-row';row.append(button);const trash=trashButton(entry);if(trash)row.append(trash);
    node.append(row);if(focused===entry.path)(focusedDelete&&trash?trash:button).focus();
  }
  function children(path,node){
    for(const entry of sorted.filter(e=>parent(e.path)===path&&visible(e))){
      if(entry.kind==='pdf'){paper(entry,node);continue;}
      const details=document.createElement('details');details.className='reader-tree-folder';details.dataset.folderPath=entry.path;details.open=!!term||expanded.has(entry.path);
      const summary=document.createElement('summary');summary.className='reader-folder';summary.dataset.paperPath=entry.path;summary.title=entry.path;
      summary.setAttribute('aria-label',entry.name+' 文件夹');summary.classList.toggle('is-selected',selectedFolder===entry.path);
      const chevron=document.createElement('span');chevron.className='reader-tree-chevron';chevron.textContent='›';chevron.setAttribute('aria-hidden','true');
      summary.append(chevron);summary.insertAdjacentHTML('beforeend',icon('folder'));const name=document.createElement('span');name.className='reader-folder-name';name.textContent=entry.name;summary.append(name);const trash=trashButton(entry);if(trash)summary.append(trash);details.append(summary);
      summary.addEventListener('click',()=>{target.querySelectorAll('.reader-folder.is-selected').forEach(n=>n.classList.remove('is-selected'));summary.classList.add('is-selected');onFolder(entry.path);});
      summary.addEventListener('keydown',event=>{if(event.key==='ArrowRight'||event.key==='ArrowLeft'){event.preventDefault();details.open=event.key==='ArrowRight';}});
      details.addEventListener('toggle',()=>{if(term)return;if(details.open)expanded.add(entry.path);else expanded.delete(entry.path);onToggle(expanded);});
      const group=document.createElement('div');group.className='reader-tree-children';group.dataset.folderChildren=entry.path;children(entry.path,group);details.append(group);node.append(details);if(focused===entry.path)(focusedDelete&&trash?trash:summary).focus();
    }
  }
  children('',target);
  const unfiled=documents.filter(d=>!represented.has(d.id)&&(!term||d.title.toLocaleLowerCase().includes(term)));
  for(const [label,papers] of [['待补充原文',unfiled.filter(d=>d.fulltext_status==='metadata_only')],['原件缺失',unfiled.filter(d=>d.fulltext_status!=='metadata_only')]]){
    if(!papers.length)continue;
    const group=document.createElement('details');group.className='reader-tree-unfiled';group.open=true;const title=document.createElement('summary');title.textContent=label;group.append(title);
    papers.forEach(d=>paper({path:'document:'+d.id,name:d.title,document_id:d.id},group));target.append(group);
  }
  if(!target.childElementCount){const p=document.createElement('p');p.className='reader-tree-empty';p.textContent=term?'没有匹配的文件夹或论文。':'这里还没有论文。可导入 PDF，或将论文放入当前工作空间。';target.append(p);}
}
