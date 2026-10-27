import { initSuite } from './suite.js';
import { mountExplorer } from './explorer.js';
initSuite();
const host=document.getElementById('workspace-files');
if(host){
  const client=window.LexiVaultSpace;
  const space=await client?.ready;
  if(space){
    mountExplorer(host,{client,space,onOpen:entry=>{
      if(entry.kind==='markdown')location.href='plans.html?file='+encodeURIComponent(entry.path);
      else if(entry.kind==='pdf' && entry.document_id)location.href='reader.html?document='+encodeURIComponent(entry.document_id);
      else location.href=`/api/workspaces/${space.id}/files/content?path=${encodeURIComponent(entry.path)}`;
    }});
  }else host.textContent='请先在文献阅读页打开一个本地工作空间。';
}
