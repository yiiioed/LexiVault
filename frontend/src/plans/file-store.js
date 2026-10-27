import {LIMITS,validPlan,uid} from './model.js';
import {markdown,sanitizeHTML,createBackup} from './formats.js';
import {marked} from 'marked';
import {openStore} from './store.js';

// Same interface as the former browser store; the local service owns persistence.
export async function openFileStore(client,space,fromHTML) {
  const base=`/api/workspaces/${space.id}/plans`, parsed=new Map(), blobs=new Map();
  let closed=false;
  const request=(suffix='',options={})=>client.request(base+suffix,options);
  async function decode(plan) {
    const cached=parsed.get(plan.id);
    if(cached?.revision===plan.revision && cached.external_error===plan.external_error && cached.missing===plan.missing)return structuredClone(cached);
    if(typeof plan.external_markdown==='string'){
      plan.doc=fromHTML(sanitizeHTML(await marked.parse(plan.external_markdown,{gfm:true})));
      delete plan.external_markdown;
    }
    validPlan(plan); parsed.set(plan.id,structuredClone(plan)); return plan;
  }
  async function allPlans() {
    const response=await request();
    api.warnings=response.warnings || [];
    return Promise.all(response.plans.filter(plan=>space.layout!=='files'||!plan.deletedAt).map(decode));
  }
  async function allFiles() {
    const entries=await request('/files');
    return Promise.all(entries.map(async file=>{
      if(file.missing)return {...file,blob:null};
      const cached=blobs.get(file.id);
      if(cached?.disk_version===file.disk_version)return {...file,blob:cached.blob};
      try {
        const response=await fetch(base+'/files/'+encodeURIComponent(file.id),{credentials:'same-origin'});
        if(!response.ok){const error=await response.json();throw new Error(error.message || '附件无法读取。');}
        const blob=await response.blob();
        if(blob.size!==file.size)throw new Error('附件大小已变化，请重新导入。');
        blobs.set(file.id,{disk_version:file.disk_version,blob});return {...file,blob};
      }catch(error){return {...file,missing:true,file_error:error.message,blob:null};}
    }));
  }
  async function batch(plans,files=[],suffix='',revisions=null) {
    plans.forEach(validPlan);
    const form=new FormData();
    const manifest={plans:plans.map((p,i)=>({plan:{...p,...(!p.revision?{directory:client.directory||''}:{})},expected_revision:revisions?.[i] ?? p.revision ?? 0,markdown:markdown(p)})),files:[]};
    for(const file of files){
      if(!file.blob || file.blob.size!==file.size || file.size>LIMITS.file)throw new Error('附件缺失或超过大小限制，原记录仍保留。');
      const {blob,...metadata}=file;manifest.files.push(metadata);form.append('uploads',blob,file.name);
    }
    form.append('manifest',JSON.stringify(manifest));
    const saved=await request(suffix,{method:'POST',body:form});
    return Promise.all(saved.map(decode));
  }
  const api={
    kind:'files',warnings:[],migrationCount:0,
    allPlans,allFiles,
    async getPlan(id){return (await allPlans()).find(p=>p.id===id);},
    async getFile(id){const file=(await allFiles()).find(f=>f.id===id);if(!file?.blob)throw new Error(file?.file_error || '本地附件已删除或无法读取。');return file;},
    async putPlan(plan,revision=0,files=[]){return (await batch([plan],files,'',[revision]))[0];},
    async importBatch(plans,files){if(plans.length)await batch(plans.map(p=>({...p,revision:0})),files,'/import');},
    async removeAttachment(id,revision){await request('/files/'+encodeURIComponent(id)+'/remove',{method:'POST',body:JSON.stringify({expected_revision:revision})});blobs.delete(id);},
    async getMeta(key){return (await request('/preferences/'+encodeURIComponent(key))).value;},
    async setMeta(key,value){await request('/preferences/'+encodeURIComponent(key),{method:'PUT',body:JSON.stringify({value})});},
    async seed(){},
    async browserBackup(){const original=await openStore('lexivault.plans.workspace.'+space.id);try{return await createBackup(await original.allPlans(),await original.allFiles());}finally{original.close();}},
    close(){closed=true;parsed.clear();blobs.clear();},
    get closed(){return closed;}
  };
  // Migrate only this workspace's browser DB. Keep its original data untouched.
  const legacyName='lexivault.plans.workspace.'+space.id, marker='browser-import:'+legacyName;
  if(space.layout!=='files' && space.schema_version!==5 && !await api.getMeta(marker)){
    let legacy;
    try{
      legacy=await openStore(legacyName);
      const originals=(await legacy.allPlans()).filter(p=>!p.sample || p.revision>1);
      if(originals.length){
        const existing=await allPlans(), byId=new Map(existing.map(p=>[p.id,p]));
        const incoming=[],mapping=new Map();
        const stable=async value=>'m-'+Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))).map(v=>v.toString(16).padStart(2,'0')).join('').slice(0,32);
        for(const plan of originals){
          const found=byId.get(plan.id);
          if(found && markdown(found)===markdown(plan) && ['summary','folder','status','startDate','dueDate','deletedAt','tags','attachmentIds'].every(k=>JSON.stringify(found[k])===JSON.stringify(plan[k])))continue;
          const copy=structuredClone(plan);
          if(found){copy.id=await stable(space.id+':'+plan.id+':'+JSON.stringify(plan));mapping.set(plan.id,copy.id);copy.title=(copy.title+'（浏览器迁移）').slice(0,160);if(byId.has(copy.id))continue;}
          copy.revision=0;copy.sample=false;incoming.push(copy);
        }
        const originalFiles=await legacy.allFiles(), uploads=[];
        for(const plan of incoming){
          const originalId=[...mapping].find(([,id])=>id===plan.id)?.[0] || plan.id;
          const fileMapping=new Map();
          for(const file of originalFiles.filter(f=>f.planId===originalId)){
            const copy={...file,planId:plan.id};
            if(originalId!==plan.id)copy.id=await stable(plan.id+':'+file.id);
            fileMapping.set(file.id,copy.id);uploads.push(copy);
          }
          plan.attachmentIds=plan.attachmentIds.map(id=>fileMapping.get(id) || id);
          const walk=node=>{if(node.type==='wikiLink' && mapping.has(node.attrs?.targetId))node.attrs.targetId=mapping.get(node.attrs.targetId);(node.content || []).forEach(walk);};walk(plan.doc);
        }
        // Split by plan, so interruption can resume without duplicating completed IDs.
        for(const plan of incoming){await api.importBatch([plan],uploads.filter(f=>f.planId===plan.id));api.migrationCount++;}
      }
      await api.setMeta(marker,true);
    }catch(error){api.migrationError='浏览器计划迁移未完成，原浏览器数据仍保留：'+error.message;}
    finally{legacy?.close();}
  }
  return api;
}
