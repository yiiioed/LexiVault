import {mountExplorer} from '../explorer.js';
import { initSuite, icon } from "../suite.js";
import { LIMITS, STATUSES, uid, escapeHTML as esc, normalizeTitle, plainText, validPlan, newPlan, collectLinks, resolveTitle, taskProgress, recentTags, localDate, renameLinkTitles, bindWikiText } from "./model.js";
import { openStore } from "./store.js";
import { openFileStore } from "./file-store.js";
import { createPlanEditor, pendingWiki, insertWiki, schemaCheck } from "./editor.js";
import { importDocument, readBackup, createBackup, markdown, htmlDocument, wordDocument } from "./formats.js";
import { monthCells, renderGraph } from "./graph.js";
const $ = (s) => document.querySelector(s), $$ = (s) => [...document.querySelectorAll(s)];
let store, editor, plans = [], files = [], current = null, dirty = false, changeVersion = 0, saving = null, saveTimer, toastTimer, activeView = "document", calendar = /* @__PURE__ */ new Date(), graphReset = () => {
}, suggestions = [], suggestIndex = 0, wikiRange = null, linkRange = null, selectedFiles = [], busyImport = false, channel;
const clone = (x) => structuredClone(x);
let removeSpaceGuard, explorer, activeSpace = null, fileRefresh, refreshingFiles = false, externalConflict = false;
function draftKey(id=current?.id) { return `lexivault.plan-draft.${activeSpace?.id}.${id}`; }
function rememberDraft() {
  if(store?.kind!=='files' || !current)return;
  try {if(dirty)localStorage.setItem(draftKey(),JSON.stringify(current));else localStorage.removeItem(draftKey());}
  catch {toast('浏览器无法保留应急草稿，请保持页面打开，必要时下载草稿。');}
}
function recoverableDraft() {
  try{
    const direct=localStorage.getItem(draftKey());
    if(direct){const draft=JSON.parse(direct);validPlan(draft);return draft;}
    const prefix=`lexivault.plan-draft.${activeSpace?.id}.`, candidates=[];
    for(let i=0;i<localStorage.length;i++){
      const key=localStorage.key(i);if(!key?.startsWith(prefix))continue;
      try{const draft=JSON.parse(localStorage.getItem(key));validPlan(draft);if(!plans.some(p=>p.id===draft.id))candidates.push(draft);}catch{}
    }
    return candidates.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))[0];
  }catch{return null;}
}
function localPath() {
  if(store?.kind!=='files')return;
  let label=$('#plan-local-path');
  if(!label){label=document.createElement('p');label.id='plan-local-path';label.className='quiet-text';label.style.cssText='overflow-wrap:anywhere;font-size:12px;margin:8px 0';($('#paper-scroll .plan-paper') || $('#paper-scroll')).prepend(label);}
  label.textContent=current?.local_path || `编辑后保存到：${activeSpace.path} / ${window.LexiVaultSpace.directory || "工作空间根目录"}`;
  if(current?.missing || current?.external_error){
    $('#save-error-text').textContent=current.external_error || '本地 Markdown 文件已删除。可以恢复文件或将当前内容另存为副本。';$('#save-error').hidden=false;
    feedback(current.missing?'本地文件已删除':'本地文件无法读取',true);
  }
}
async function refreshLocalFiles() {
  if(store?.kind!=='files' || store.closed || refreshingFiles || saving || busyImport || document.hidden)return;
  refreshingFiles=true;
  const id=current?.id, generation=changeVersion;
  try{
    const fresh=await store.allPlans(), freshFiles=await store.allFiles();
    if(store.closed || saving || busyImport || current?.id!==id || changeVersion!==generation)return;
    const disk=fresh.find(p=>p.id===id);
    if(!disk && current?.revision && dirty){externalConflict=true;clearTimeout(saveTimer);rememberDraft();showError(new Error('本地文档已被删除，当前草稿仍保留，请另存为副本。'));return;}
    const changed=disk && (disk.revision!==current.revision || disk.missing!==current.missing || disk.external_error!==current.external_error);
    if(changed && dirty){
      externalConflict=true;clearTimeout(saveTimer);rememberDraft();showError(new Error('本地文件已被外部修改，当前草稿未覆盖磁盘。请另存为副本，或载入本地版本。'));return;
    }
    plans=dirty?fresh.map(p=>p.id===id?current:p):fresh;files=freshFiles;
    if(!disk && current?.revision){current=clone(fresh.find(p=>!p.deletedAt)||newPlan());changeVersion++;editor.commands.setContent(current.doc,{emitUpdate:false});fillFields();renderList();renderRelations();renderAttachments();localPath();feedback('本地文档已删除');}
    else if(changed){current=null;await openPlan(id);if(!disk.missing && !disk.external_error)feedback('已载入外部修改');}
    else {renderList();renderRelations();renderAttachments();}
  }catch(error){if(dirty)showError(error);else feedback('无法同步本地文件：'+error.message,true);}
  finally{refreshingFiles=false;}
}

function toast(message) {
  $("#suite-toast").textContent = message;
  $("#suite-toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("#suite-toast").hidden = true, 5e3);
}
function feedback(text, error = false) {
  $("#save-indicator").textContent = text;
  $("#save-indicator").classList.toggle("is-error", error);
}
function showError(error) {
  feedback("草稿尚未保存", true);
  $("#save-error-text").textContent = error.message || String(error);
  $("#save-error").hidden = false;
}
function safe(action) {
  return async (...args) => {
    try {
      return await action(...args);
    } catch (error) {
      if (dirty || saving) showError(error);
      toast(error.message || "操作未完成，当前内容仍保留。");
    }
  };
}
function replacePlan(p) {
  const i = plans.findIndex((x) => x.id === p.id);
  if (i < 0) plans.unshift(p);
  else plans[i] = p;
}
function syncDraft() {
  if (!current || !editor) return;
  current.doc = editor.getJSON();
  replacePlan(current);
}
function markDirty() {
  if (!current || current.deletedAt) return;
  syncDraft();
  dirty = true;
  changeVersion++;
  current.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
  replacePlan(current);
  rememberDraft();
  feedback("正在编辑…");
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveDraft().catch(showError), 550);
  renderList();
  updateMeta();
  renderRelations();
}
async function saveDraft() {
  clearTimeout(saveTimer);
  if (saving) {
    await saving;
    if (dirty) return saveDraft();
    return true;
  }
  if (!current || !dirty) return true;
  if(externalConflict)throw new Error("请先处理外部修改冲突；草稿可另存为副本或下载。");
  syncDraft();
  const snapshot = clone(current), version = changeVersion;
  validPlan(snapshot);
  schemaCheck(editor, snapshot.doc);
  feedback("正在保存…");
  saving = (async () => {
    const saved = await store.putPlan(snapshot, snapshot.revision);
    if (current?.id === saved.id) {
      current.revision = saved.revision;
      if(store.kind==='files'){current.local_path=saved.local_path;current.missing=saved.missing;current.external_error=saved.external_error;}
      if (changeVersion === version) {
        current = saved;
        dirty = false;
      }
      replacePlan(current);
    } else replacePlan(saved);
    $("#save-error").hidden = true;
    rememberDraft();localPath();
    feedback(dirty ? "继续保存…" : store.kind==='files' ? "已保存到本地" : "已保存到此浏览器");
    void explorer?.refresh();
    channel?.postMessage({ id: saved.id });
    return true;
  })();
  try {
    await saving;
  } finally {
    saving = null;
  }
  if (dirty) return saveDraft();
  return true;
}
async function flush() {
  try {
    await saveDraft();
    return true;
  } catch (error) {
    showError(error);
    toast("请先处理未保存的草稿，或另存为副本。");
    return false;
  }
}
function renderList() {
  const term = normalizeTitle($("#plan-search").value), filter = $("#plan-filter").value, sort = $("#plan-sort").value;
  const shown = plans.filter((p) => (filter === "trash" ? !!p.deletedAt : !p.deletedAt && (filter === "all" || p.status === filter)) && (!term || normalizeTitle([p.title, p.summary, p.folder, p.tags.join(" "), plainText(p.doc)].join(" ")).includes(term)));
  shown.sort((a, b) => sort === "title" ? a.title.localeCompare(b.title, "zh-CN") : sort === "due" ? (a.dueDate || "9999").localeCompare(b.dueDate || "9999") : b.updatedAt.localeCompare(a.updatedAt));
  const groups = /* @__PURE__ */ new Map();
  shown.forEach((p) => {
    if (!groups.has(p.folder)) groups.set(p.folder, []);
    groups.get(p.folder).push(p);
  });
  $("#plan-list").innerHTML = shown.length ? [...groups].map(([folder, list]) => `<h3 class="plan-folder-heading">${esc(folder || "未分类")} <span>· ${list.length}</span></h3>${list.map((p) => `<button type="button" class="plan-list-item ${p.id === current?.id ? "is-selected" : ""}" data-open-plan="${p.id}" aria-current="${p.id === current?.id ? "true" : "false"}"><strong>${esc(p.title || "未命名计划")}</strong><span class="list-snippet">${esc(p.summary || plainText(p.doc).slice(0, 60) || "写下你的下一步研究安排")}</span><small><span>${p.deletedAt ? "回收站" : STATUSES[p.status]}</span><span>${esc(p.dueDate || p.updatedAt.slice(0, 10))}</span></small></button>`).join("")}`).join("") : '<p class="empty-hint">没有匹配的计划。可以新建文档，或导入你已有的安排。</p>';
  $("#folder-options").innerHTML = [...new Set(plans.filter((p) => !p.deletedAt).map((p) => p.folder).filter(Boolean))].map((x) => `<option value="${esc(x)}"></option>`).join("");
}
function fillFields() {
  for (const [id, key] of [["plan-title", "title"], ["plan-summary", "summary"], ["plan-status", "status"], ["plan-start", "startDate"], ["plan-due", "dueDate"], ["plan-folder", "folder"]]) $("#" + id).value = current[key];
  $("#plan-tags").value = current.tags.join("，");
  $("#sample-label").hidden = !current.sample;
  $("#restore-plan").hidden = !current.deletedAt;
  $("#trash-plan").hidden = !!current.deletedAt;
  if(store?.kind==='files' && activeSpace?.layout==='files'){$('#trash-plan').textContent='删除文档';$('#restore-plan').hidden=true;}
  $("#archive-plan").hidden = !!current.deletedAt;
  $$(".plan-toolbar button,.plan-toolbar select,.plan-toolbar input,#plan-title,#plan-summary,#plan-inspector input,#plan-inspector select,#image-button").forEach((el) => el.disabled = !!current.deletedAt);
  editor.setEditable(!current.deletedAt, false);
  $("#archive-plan").textContent = current.status === "archived" ? "取消归档" : "归档计划";
  updateMeta();
  renderAttachments();
  localPath();
}
function updateMeta() {
  if (!current) return;
  $("#topbar-detail").textContent = current.title || "未命名计划";
  $("#plan-state-pill").textContent = current.deletedAt ? "回收站 · 只读" : STATUSES[current.status];
  $("#plan-date-label").textContent = current.startDate || current.dueDate ? `${current.startDate || "未设开始"} → ${current.dueDate || "未设截止"}` : "尚未排期";
  $("#plan-folder-label").textContent = current.folder || "未分类";
  $("#archive-plan").textContent = current.status === "archived" ? "取消归档" : "归档计划";
  $("#plan-updated").textContent = "最近编辑 " + new Date(current.updatedAt).toLocaleString("zh-CN", { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" });
  const progress = taskProgress(current.doc);
  $("#task-progress").innerHTML = progress.total ? `${progress.done} / ${progress.total} 项已完成<div class="task-track"><span style="width:${Math.round(progress.done / progress.total * 100)}%"></span></div>` : "正文中添加待办清单，即可跟踪进度。";
  const chars = plainText(current.doc).replace(/\s/g, "").length;
  $("#word-count").textContent = chars.toLocaleString("zh-CN") + " 字符";
}
function renderRelations() {
  if (!current) return;
  const out = collectLinks(current, plans), back = plans.filter((p) => !p.deletedAt && p.id !== current.id && collectLinks(p, plans).some((l) => l.targetId === current.id && l.state === "resolved"));
  $("#backlinks").innerHTML = back.length ? back.map((p) => `<button type="button" class="inspector-link" data-open-plan="${p.id}">${esc(p.title)}<small>${esc(p.folder)}</small></button>`).join("") : '<p class="empty-hint">还没有其他计划引用这里。</p>';
  const unique = [...new Map(out.map((l) => [(l.targetId || l.title) + l.state, l])).values()];
  $("#outlinks").innerHTML = unique.length ? unique.map((l) => `<button type="button" class="inspector-link" ${l.state === "resolved" || l.state === "deleted" ? `data-open-plan="${l.targetId}"` : `data-find-link="${esc(l.title)}"`}>${esc(l.alias || l.title)}<small>${{ resolved: "内部链接", deleted: "目标在回收站", ambiguous: "存在同名计划，请选择", missing: "未创建的计划" }[l.state]}</small></button>`).join("") : '<p class="empty-hint">输入 [[计划名称]] 建立链接。</p>';
  if (activeView === "relations") drawGraph();
}
function renderAttachments() {
  const attached = files.filter((f) => f.planId === current?.id && current.attachmentIds.includes(f.id));
  $("#attachment-count").textContent = attached.length ? "· " + attached.length : "";
  $("#attachment-list").innerHTML = attached.length ? attached.map((f) => `<div class="attachment-row">${icon("plan")}<button type="button" class="attachment-name" data-file="${f.id}">${esc(f.name)}</button><small>${fileSize(f.size)}</small><button type="button" data-remove-file="${f.id}" aria-label="移除附件：${esc(f.name)}" ${current.deletedAt ? "disabled" : ""}>×</button></div>`).join("") : '<p class="attachment-empty">可以从左下角导入任意格式的原始文件，也可以把文件拖入页面。</p>';
}
const fileSize = (n) => n >= 1048576 ? (n / 1048576).toFixed(1) + " MiB" : Math.max(1, Math.round(n / 1024)) + " KiB";
async function openPlan(id) {
  if (id === current?.id) {
    view("document");
    return;
  }
  if (!await flush()) return;
  const target = plans.find((p) => p.id === id);
  if (!target) {
    toast("这份计划已经不可用。");
    return;
  }
  current = clone(target);
  dirty = false;
  changeVersion++;
  editor.commands.setContent(current.doc, { emitUpdate: false });
  fillFields();
  renderList();
  renderRelations();
  feedback(plans.length ? (store.kind==='files'?"已保存到本地":"已保存到此浏览器") : "空白计划 · 编辑后保存");
  $("#save-error").hidden = true;
  localPath();
  if(store.kind==='files'){
    try{const raw=localStorage.getItem(draftKey());if(raw){const draft=JSON.parse(raw);validPlan(draft);current=draft;dirty=true;externalConflict=draft.revision!==target.revision;editor.commands.setContent(draft.doc,{emitUpdate:false});fillFields();showError(new Error("已恢复尚未保存的浏览器草稿。请核对后保存，或另存为副本。"));}}catch(error){toast("应急草稿无法自动读取，原始缓存仍保留。");}
  }
  store.setMeta("lastPlan", id).catch(() => {
  });
  if (current.deletedAt) $("#plan-filter").value = "trash";
  else if ($("#plan-filter").value === "trash") $("#plan-filter").value = "all";
  renderList();
  view("document");
  document.body.classList.remove("list-open");
  $("#paper-scroll").scrollTop = 0;
}
function checkCapacity(add = 1) {
  if (plans.length + add > LIMITS.plans) throw new Error("当前版本最多保留 2000 份计划（含回收站）。请先导出备份。");
}
async function addPlan(template = false) {
  if (!await flush()) return;
  checkCapacity();
  const p = newPlan(template ? "新的科研推进计划" : "未命名计划");
  if (template) p.doc = { type: "doc", content: [{ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "研究问题与假设" }] }, { type: "paragraph", content: [{ type: "text", text: "我希望回答什么问题？现有文献给出了哪些证据，仍存在哪些不确定性？" }] }, { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "行动与验证" }] }, { type: "taskList", content: [{ type: "taskItem", attrs: { checked: false }, content: [{ type: "paragraph", content: [{ type: "text", text: "整理关键文献与可检验证据" }] }] }, { type: "taskItem", attrs: { checked: false }, content: [{ type: "paragraph", content: [{ type: "text", text: "确定数据划分、基线与评价指标" }] }] }] }, { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "结果、复盘与下一步" }] }, { type: "paragraph" }] };
  replacePlan(await store.putPlan(p, 0));
  $("#plan-filter").value = "all";
  $("#plan-search").value = "";
  await openPlan(p.id);
  await explorer?.refresh();
  $("#plan-title").focus();
  $("#plan-title").select();
}
async function copyCurrent() {
  if (!current) return;
  syncDraft();
  checkCapacity();
  const oldDraftId=current.id;
  const p = clone(current);
  p.id = uid();
  p.title = (p.title + "（副本）").slice(0, 160);
  p.deletedAt = null;
  p.revision = 0;
  p.sample = false;
  p.createdAt = p.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
  const fs = files.filter((f) => current.attachmentIds.includes(f.id)).map((f) => ({ ...f, id: uid(), planId: p.id }));
  p.attachmentIds = fs.map((f) => f.id);
  const saved = await store.putPlan(p, 0, fs);
  files.push(...fs);
  replacePlan(saved);
  dirty = false;
  current = saved;
  externalConflict=false;rememberDraft();
  if(store.kind==='files'){try{localStorage.removeItem(draftKey(oldDraftId));}catch{}}
  fillFields();
  renderList();
  renderRelations();
  $("#save-error").hidden = true;
  feedback("副本已保存");
  toast("已另存为副本，原计划仍保留。");
}
function view(name) {
  activeView = name;
  for (const n of ["document", "calendar", "relations"]) {
    $("#" + n + "-view").hidden = n !== name;
    const tab = $(`[data-plan-view="${n}"]`);
    tab.classList.toggle("is-active", n === name);
    tab.setAttribute("aria-selected", String(n === name));
    tab.tabIndex = n === name ? 0 : -1;
  }
  if (name === "calendar") renderCalendar();
  if (name === "relations") drawGraph();
}
function renderCalendar() {
  const year = calendar.getFullYear(), month = calendar.getMonth();
  $("#calendar-title").textContent = `${year} 年 ${month + 1} 月`;
  const eligible = plans.filter((p) => !p.deletedAt && p.status !== "archived"), today = localDate();
  $("#calendar-grid").innerHTML = ["一", "二", "三", "四", "五", "六", "日"].map((d) => `<div class="weekday">周${d}</div>`).join("") + monthCells(year, month).map((c) => {
    const ps = eligible.filter((p) => {
      const start = p.startDate || p.dueDate, end = p.dueDate || p.startDate;
      return start && start <= c.date && end >= c.date;
    });
    return `<div class="calendar-day ${c.outside ? "is-outside" : ""} ${c.date === today ? "is-today" : ""}" aria-label="${c.date}"><span>${c.day}</span>${ps.slice(0, 3).map((p) => calendarButton(p)).join("")}${ps.length > 3 ? `<button class="calendar-more" type="button" data-calendar-date="${c.date}">还有 ${ps.length - 3} 项</button>` : ""}</div>`;
  }).join("");
  $("#unscheduled-plans").innerHTML = eligible.filter((p) => !p.startDate && !p.dueDate).map((p) => calendarButton(p)).join("") || '<span class="empty-hint">所有计划都已安排日期。</span>';
}
function calendarButton(p) {
  return `<button type="button" class="calendar-plan" data-status="${p.status}" data-open-plan="${p.id}" title="${esc(p.title)}">${esc(p.title)}</button>`;
}
function drawGraph() {
  syncDraft();
  graphReset = renderGraph($("#plan-graph"), plans, current?.id, (id) => safe(openPlan)(id), $("#graph-search").value);
  $("#recent-tags").innerHTML = recentTags(plans).map(([tag, count]) => `<button type="button" class="tag-chip" data-graph-tag="${esc(tag)}">${esc(tag)}<small>${count} 份</small></button>`).join("") || '<span class="empty-hint">为计划添加标签后，会在这里呈现关联。</span>';
}
function download(blob, name) {
  const url = URL.createObjectURL(blob), a = document.createElement("a");
  a.href = url;
  a.download = name.replace(/[\\/:*?"<>|]/g, "_");
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3e4);
}
async function exportFile(kind) {
  closeMenus();
  syncDraft();
  if (!current) return;
  const name = current.title || "研究计划";
  if (kind === "backup") {
    await flush();
    const map = new Map(plans.map((p) => [p.id, p]));
    if (current) map.set(current.id, clone(current));
    if(files.some(f=>!f.blob))throw new Error('存在缺失或无法读取的附件，请先恢复文件，再导出完整备份。');
    download(await createBackup([...map.values()], files), "LexiVault-完整备份-" + localDate() + ".zip");
    toast("备份已生成，包含计划正文、链接关系和原始附件。");
  } else if (kind === "docx") {
    download(await wordDocument(current), name + ".docx");
    toast("Word 已导出，正文图片请参阅 HTML 或原件。");
  } else if (kind === "markdown") download(new Blob([markdown(current)], { type: "text/markdown;charset=utf-8" }), name + ".md");
  else if (kind === "html") download(new Blob([htmlDocument(current, editor.getHTML())], { type: "text/html;charset=utf-8" }), name + ".html");
}
function attachment(file, planId) {
  return { id: uid(), planId, name: file.name.slice(0, 500), type: file.type || "application/octet-stream", size: file.size, createdAt: (/* @__PURE__ */ new Date()).toISOString(), blob: file };
}
function fromHTML(html) {
  const temp = document.createElement("div"), instance = createPlanEditor(temp, { getPlans: () => plans });
  try {
    instance.commands.setContent(html, { emitUpdate: false });
    const doc = bindWikiText(instance.getJSON(), plans);
    schemaCheck(instance, doc);
    return doc;
  } finally {
    instance.destroy();
  }
}
function openImport(incoming) {
  if (current?.deletedAt) {
    toast("先恢复当前计划，或选择其他计划后再导入。");
    return;
  }
  selectedFiles = incoming ? [...incoming] : [];
  $("#import-files").value = "";
  $("#import-status").textContent = "";
  renderSelectedFiles();
  $("#import-dialog").showModal();
}
function renderSelectedFiles() {
  $("#import-file-list").textContent = selectedFiles.map((f) => f.name + " · " + fileSize(f.size)).join("；");
}
async function runImport() {
  if (busyImport) return;
  if (!selectedFiles.length) {
    $("#import-status").textContent = "请先选择文件。";
    return;
  }
  if (!await flush()) return;
  busyImport = true;
  $("#confirm-import").disabled = true;
  $$("#import-dialog [data-close-dialog],#import-dialog input").forEach((el) => el.disabled = true);
  const results = [];
  let lastId;
  try {
    for (let i = 0; i < selectedFiles.length; i++) {
      const f = selectedFiles[i];
      $("#import-status").textContent = `正在处理 ${i + 1} / ${selectedFiles.length}：${f.name}`;
      try {
        const mode = $('input[name="import-mode"]:checked').value;
        if (mode === "document" && /\.zip$/i.test(f.name)) {
          if (f.size > LIMITS.backup) throw new Error("ZIP 超过 100 MiB。");
          const restored = await readBackup(f);
          if (restored) {
            checkCapacity(restored.plans.length);
            restored.plans.forEach((p) => schemaCheck(editor, p.doc));
            await store.importBatch(restored.plans, restored.files);
            plans = await store.allPlans();
            files = await store.allFiles();
            lastId = restored.plans.find((p) => !p.deletedAt)?.id;
            results.push(`✓ ${f.name}：已合并 ${restored.plans.length} 份计划副本，原有内容保留。`);
            continue;
          }
        }
        if (f.size > LIMITS.file) throw new Error("单文件超过 50 MiB。");
        if(mode==='document' && explorer && /\.(md|markdown)$/i.test(f.name)){
          const form=new FormData();form.append('directory',window.LexiVaultSpace.directory||'');form.append('files',f,f.name);
          const uploaded=await window.LexiVaultSpace.request(`/api/workspaces/${activeSpace.id}/files/upload`,{method:'POST',body:form});
          plans=await store.allPlans();lastId=plans.find(p=>p.relative_path===uploaded.files[0].path)?.id;
          results.push(`✓ ${f.name}：已保存到本地，可直接编辑。`);await explorer.refresh();continue;
        }
        if (mode === "attachment") {
          const copy = clone(current), original = attachment(f, copy.id);
          copy.attachmentIds.push(original.id);
          copy.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
          const saved = await store.putPlan(copy, copy.revision, [original]);
          current = saved;
          replacePlan(saved);
          files.push(original);
          results.push(`✓ ${f.name}：原件附件已保存。`);
        } else {
          checkCapacity();
          const converted = await importDocument(f);
          let doc;
          try {
            doc = fromHTML(converted.html);
            validPlan(newPlan(converted.title, doc));
          } catch (error) {
            converted.converted = false;
            converted.warning = "正文结构超出支持范围，原始文件已保留。";
            doc = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "原始附件：" + f.name }] }, { type: "paragraph", content: [{ type: "text", text: "可在这里继续补充研究安排，原件可随时下载。" }] }] };
          }
          const p = newPlan(converted.title, doc), original = attachment(f, p.id);
          p.attachmentIds = [original.id];
          const saved = await store.putPlan(p, 0, [original]);
          replacePlan(saved);
          files.push(original);
          lastId = p.id;
          results.push(`✓ ${f.name}：${converted.converted ? "已转为可编辑正文。" : "已保存为原件附件。"}${converted.warning}`);
        }
      } catch (error) {
        results.push(`× ${f.name}：${error.message}`);
      }
    }
    if (lastId) {
      $("#plan-filter").value = "all";
      $("#plan-search").value = "";
      await openPlan(lastId);
    } else {
      fillFields();
      renderList();
      renderRelations();
    }
    $("#import-status").textContent = results.join("\n\n");
    channel?.postMessage({ import: true });
    selectedFiles = [];
    $("#import-files").value = "";
    renderSelectedFiles();
  } finally {
    busyImport = false;
    $("#confirm-import").disabled = false;
    $$("#import-dialog [data-close-dialog],#import-dialog input").forEach((el) => el.disabled = false);
  }
}
function toolbarState() {
  if (!editor || !current) return;
  const states = { bold: "bold", italic: "italic", underline: "underline", strike: "strike", bulletList: "bulletList", orderedList: "orderedList", taskList: "taskList", blockquote: "blockquote" };
  for (const [key, node] of Object.entries(states)) {
    const b = $(`[data-command="${key}"]`), active = editor.isActive(node);
    b.classList.toggle("is-active", active);
    b.setAttribute("aria-pressed", String(active));
  }
  $("#undo-button").disabled = !!current.deletedAt || !editor.can().undo();
  $("#redo-button").disabled = !!current.deletedAt || !editor.can().redo();
  $("#block-style").value = editor.isActive("heading") ? String(editor.getAttributes("heading").level) : "paragraph";
  const style = editor.getAttributes("textStyle");
  $("#font-size").value = $$("#font-size option").some((x) => x.value === style.fontSize) ? style.fontSize : "16px";
  $("#font-family").value = $$("#font-family option").some((x) => x.value === style.fontFamily) ? style.fontFamily : "Lexi Sans";
}
function runCommand(command) {
  if (current?.deletedAt) return;
  const chain = editor.chain().focus(), actions = { bold: "toggleBold", italic: "toggleItalic", underline: "toggleUnderline", strike: "toggleStrike", bulletList: "toggleBulletList", orderedList: "toggleOrderedList", taskList: "toggleTaskList", blockquote: "toggleBlockquote", unsetHighlight: "unsetHighlight" };
  if (actions[command]) chain[actions[command]]().run();
  else if (["left", "center", "right"].includes(command)) chain.setTextAlign(command).run();
  else if (command === "clear") chain.unsetAllMarks().clearNodes().run();
  toolbarState();
}
function closeMenus() {
  $$(".s-popover").forEach((p) => {
    p.hidden = true;
    $(`[aria-controls="${p.id}"]`)?.setAttribute("aria-expanded", "false");
  });
}
function toggleMenu(id, button) {
  const open = $("#" + id).hidden;
  closeMenus();
  $("#" + id).hidden = !open;
  button.setAttribute("aria-expanded", String(open));
}
function showLinkDialog(query = "", range = null) {
  if (current.deletedAt) return;
  hideSuggestions();
  linkRange = range || { from: editor.state.selection.from, to: editor.state.selection.to };
  $("#link-query").value = query;
  renderLinkResults();
  $("#link-dialog").showModal();
  $("#link-query").focus();
}
function renderLinkResults() {
  const query = $("#link-query").value.trim(), term = normalizeTitle(query), matches = plans.filter((p) => !p.deletedAt && (!term || normalizeTitle(p.title).includes(term))).slice(0, 30);
  $("#link-results").innerHTML = matches.map((p) => `<button type="button" data-link-plan="${p.id}">${esc(p.title)}<small>${esc(p.folder)} · ${p.id.slice(0, 8)}</small></button>`).join("") + (query && !plans.some((p) => !p.deletedAt && normalizeTitle(p.title) === term) ? `<button type="button" data-create-link>新建并链接「${esc(query)}」<small>创建一份空白计划，继续留在当前文档</small></button>` : "") || '<p class="empty-hint">输入要关联的计划名称。</p>';
}
async function chooseLink(id, range = linkRange) {
  const target = plans.find((p) => p.id === id);
  if (!target) return;
  $("#link-dialog").close();
  hideSuggestions();
  insertWiki(editor, { targetId: target.id, title: target.title }, range);
  renderRelations();
}
async function createLinked(title, range) {
  if (!await flush()) return;
  title = title.trim().slice(0, 160);
  if (!title) return;
  checkCapacity();
  const existing = resolveTitle(title, plans);
  if (existing) return chooseLink(existing.id, range);
  const p = await store.putPlan(newPlan(title), 0);
  replacePlan(p);
  await chooseLink(p.id, range);
  renderList();
  toast("已创建并链接：" + title);
}
async function navigateWiki(link) {
  if (link.targetId) {
    if (plans.some((p) => p.id === link.targetId)) return openPlan(link.targetId);
  }
  const target = resolveTitle(link.title, plans);
  if (target) return openPlan(target.id);
  showLinkDialog(link.title, link.range);
}
function hideSuggestions() {
  $("#wiki-suggestions").hidden = true;
  suggestions = [];
  wikiRange = null;
}
function updateSuggestions() {
  if (!editor || current?.deletedAt) return hideSuggestions();
  const pending = pendingWiki(editor);
  if (!pending) return hideSuggestions();
  wikiRange = { from: pending.from, to: pending.to };
  const term = normalizeTitle(pending.query);
  suggestions = plans.filter((p) => !p.deletedAt && normalizeTitle(p.title).includes(term)).slice(0, 7).map((p) => ({ id: p.id, title: p.title, folder: p.folder }));
  if (pending.query.trim() && !plans.some((p) => !p.deletedAt && normalizeTitle(p.title) === term)) suggestions.push({ title: pending.query.trim(), create: true });
  if (!suggestions.length) return hideSuggestions();
  suggestIndex = Math.min(suggestIndex, suggestions.length - 1);
  const el = $("#wiki-suggestions");
  el.innerHTML = suggestions.map((s, i) => `<button type="button" role="option" aria-selected="${i === suggestIndex}" data-suggestion="${i}" class="${i === suggestIndex ? "is-selected" : ""}">${s.create ? "新建并链接：" : ""}${esc(s.title)}<small>${s.create ? "继续留在当前计划" : esc(s.folder)}</small></button>`).join("");
  el.hidden = false;
  let rect;
  try {
    rect = editor.view.coordsAtPos(pending.to);
  } catch {
    rect = { left: window.innerWidth / 2, bottom: 200 };
  }
  el.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - 288)) + "px";
  el.style.top = Math.max(8, Math.min(rect.bottom + 8, window.innerHeight - 250)) + "px";
}
async function pickSuggestion(index) {
  const suggestion = suggestions[index], range = wikiRange;
  if (!suggestion) return;
  if (suggestion.create) await createLinked(suggestion.title, range);
  else await chooseLink(suggestion.id, range);
}
function onEditorKey(event) {
  if (event.isComposing) return false;
  if (event.key === "Enter" && event.target.closest?.("[data-wiki-title]")) {
    const el = event.target;
    const pos = editor.view.posAtDOM(el.parentNode, [...el.parentNode.childNodes].indexOf(el));
    safe(navigateWiki)({ targetId: el.dataset.wikiTarget, title: el.dataset.wikiTitle, range: { from: pos, to: pos + 1 } });
    return true;
  }
  if ($("#wiki-suggestions").hidden) return false;
  if (["ArrowDown", "ArrowUp"].includes(event.key)) {
    event.preventDefault();
    suggestIndex = (suggestIndex + (event.key === "ArrowDown" ? 1 : -1) + suggestions.length) % suggestions.length;
    updateSuggestions();
    return true;
  }
  if (event.key === "Enter") {
    event.preventDefault();
    safe(pickSuggestion)(suggestIndex);
    return true;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    hideSuggestions();
    return true;
  }
  return false;
}
async function renameReferences(id, title) {
  for (const source of [...plans]) {
    if (source.id === id || source.deletedAt) continue;
    const p = clone(source);
    if (!renameLinkTitles(p.doc, id, title)) continue;
    try {
      replacePlan(await store.putPlan(p, p.revision));
    } catch (error) {
      toast("部分链接标题将在下次打开时按目标更新；目标关联仍然保留。");
    }
  }
  renderRelations();
}
function bind() {
  initSuite();
  $$("[data-plan-view]").forEach((b) => b.addEventListener("click", () => view(b.dataset.planView)));
  $("[role=tablist]").addEventListener("keydown", (e) => {
    const tabs = $$("[data-plan-view]"), i = tabs.indexOf(document.activeElement);
    if (i < 0) return;
    let n;
    if (e.key === "ArrowRight") n = (i + 1) % 3;
    if (e.key === "ArrowLeft") n = (i + 2) % 3;
    if (e.key === "Home") n = 0;
    if (e.key === "End") n = 2;
    if (n !== void 0) {
      e.preventDefault();
      tabs[n].focus();
      view(tabs[n].dataset.planView);
    }
  });
  $("#new-plan").addEventListener("click", safe(() => addPlan()));
  $("#plan-template").addEventListener("click", safe(() => {
    closeMenus();
    return addPlan(true);
  }));
  $("#plan-search").addEventListener("input", renderList);
  $("#plan-filter").addEventListener("change", renderList);
  $("#plan-sort").addEventListener("change", renderList);
  $("#plans-list-toggle").addEventListener("click", () => {
    const open = document.body.classList.toggle("list-open");
    $("#plans-list-toggle").setAttribute("aria-expanded", String(open));
  });
  document.body.classList.toggle("inspector-collapsed", window.innerWidth < 1281);
  function inspectorLabel() {
    const collapsed = document.body.classList.contains("inspector-collapsed");
    $("#toggle-inspector").setAttribute("aria-expanded", String(!collapsed));
    $("#toggle-inspector").setAttribute("aria-label", collapsed ? "展开文档信息与反向链接" : "收起文档信息与反向链接");
  }
  inspectorLabel();
  $("#toggle-inspector").addEventListener("click", () => {
    document.body.classList.toggle("inspector-collapsed");
    inspectorLabel();
  });
  document.addEventListener("click", safe(async (e) => {
    if (!e.target.closest("#plan-list-pane,#plans-list-toggle")) document.body.classList.remove("list-open");
    const op = e.target.closest("[data-open-plan]");
    if (op) return openPlan(op.dataset.openPlan);
    const unresolved = e.target.closest("[data-find-link]");
    if (unresolved) return showLinkDialog(unresolved.dataset.findLink);
    const file = e.target.closest("[data-file]");
    if (file) {
      const f = files.find((x) => x.id === file.dataset.file);
      if (f) download(f.blob, f.name);
      return;
    }
    const remove = e.target.closest("[data-remove-file]");
    if (remove) {
      if (!window.confirm("从当前计划移除此附件？原始电脑文件不会受影响。")) return;
      if (!await flush()) return;
      const id = current.id;
      await store.removeAttachment(remove.dataset.removeFile,current.revision);
      files = await store.allFiles();
      const p = await store.getPlan(id);
      if (current.id === id) {
        current.attachmentIds = p.attachmentIds;
        current.revision = p.revision;
        replacePlan(current);
      } else replacePlan(p);
      renderAttachments();
      return;
    }
    const choice = e.target.closest("[data-link-plan]");
    if (choice) return chooseLink(choice.dataset.linkPlan);
    if (e.target.closest("[data-create-link]")) return createLinked($("#link-query").value, linkRange);
    const sug = e.target.closest("[data-suggestion]");
    if (sug) return pickSuggestion(Number(sug.dataset.suggestion));
    const tag = e.target.closest("[data-graph-tag]");
    if (tag) {
      $("#graph-search").value = tag.dataset.graphTag;
      drawGraph();
      return;
    }
    const extra = e.target.closest("[data-calendar-date]");
    if (extra) {
      const date = extra.dataset.calendarDate, eligible = plans.filter((p) => !p.deletedAt && p.status !== "archived" && (p.startDate || p.dueDate) <= date && (p.dueDate || p.startDate) >= date);
      extra.outerHTML = eligible.slice(3).map(calendarButton).join("");
      return;
    }
    if (!e.target.closest(".s-menu-anchor")) closeMenus();
    if (!e.target.closest("#wiki-suggestions,#plan-editor")) hideSuggestions();
  }));
  for (const [id, key] of [["plan-title", "title"], ["plan-summary", "summary"], ["plan-folder", "folder"], ["plan-tags", "tags"]]) $("#" + id).addEventListener("input", () => {
    if (current.deletedAt) return;
    current[key] = key === "tags" ? [...new Set($("#" + id).value.split(/[,，;；]/).map((x) => x.trim().slice(0, 30)).filter(Boolean))].slice(0, 20) : $("#" + id).value;
    markDirty();
  });
  $("#plan-title").addEventListener("change", safe(async () => {
    const id = current.id, title = current.title;
    if (await flush()) await renameReferences(id, title);
  }));
  for (const [id, key] of [["plan-start", "startDate"], ["plan-due", "dueDate"], ["plan-status", "status"]]) $("#" + id).addEventListener("change", () => {
    const value = $("#" + id).value, start = id === "plan-start" ? value : current.startDate, due = id === "plan-due" ? value : current.dueDate;
    if (start && due && start > due) {
      $("#" + id).value = current[key];
      toast("截止日期不能早于开始日期。");
      return;
    }
    current[key] = value;
    markDirty();
  });
  $$(".plan-toolbar button").forEach((b) => b.addEventListener("mousedown", (e) => e.preventDefault()));
  $$("[data-command]").forEach((b) => b.addEventListener("click", () => runCommand(b.dataset.command)));
  $("#block-style").addEventListener("change", (e) => {
    const c = editor.chain().focus();
    e.target.value === "paragraph" ? c.setParagraph().run() : c.setHeading({ level: Number(e.target.value) }).run();
  });
  $("#font-family").addEventListener("change", (e) => editor.chain().focus().setFontFamily(e.target.value).run());
  $("#font-size").addEventListener("change", (e) => editor.chain().focus().setFontSize(e.target.value).run());
  $("#text-color").addEventListener("input", (e) => editor.chain().focus().setColor(e.target.value).run());
  $("#highlight-color").addEventListener("input", (e) => editor.chain().focus().setHighlight({ color: e.target.value }).run());
  $("#undo-button").addEventListener("click", () => editor.chain().focus().undo().run());
  $("#redo-button").addEventListener("click", () => editor.chain().focus().redo().run());
  $("#wiki-button").addEventListener("click", () => showLinkDialog());
  $("#link-query").addEventListener("input", renderLinkResults);
  $("#wiki-suggestions").addEventListener("mousedown", (e) => e.preventDefault());
  for (const [button, menu] of [["export-button", "export-menu"], ["plan-more", "plan-more-menu"], ["table-button", "table-menu"]]) $("#" + button).addEventListener("click", (e) => toggleMenu(menu, e.currentTarget));
  $$("[data-table]").forEach((b) => b.addEventListener("click", () => {
    const c = editor.chain().focus();
    ({ insert: () => c.insertTable({ rows: 3, cols: 3, withHeaderRow: true }), row: () => c.addRowAfter(), column: () => c.addColumnAfter(), remove: () => c.deleteTable() })[b.dataset.table]().run();
    closeMenus();
  }));
  $$("[data-export]").forEach((b) => b.addEventListener("click", safe(() => exportFile(b.dataset.export))));
  $("#duplicate-plan").addEventListener("click", safe(() => {
    closeMenus();
    return copyCurrent();
  }));
  $("#save-copy").addEventListener("click", safe(copyCurrent));
  $("#reload-plan").addEventListener("click", safe(async () => {
    if (!window.confirm("载入已保存版本并放弃当前未保存的修改？")) return;
    const id = current.id;
    if(store.kind==='files'){try{localStorage.removeItem(draftKey());}catch{}}
    externalConflict=false;
    dirty = false;
    current = null;
    plans = await store.allPlans();
    files = await store.allFiles();
    await openPlan(id);
  }));
  for (const [id, action] of [["archive-plan", "archive"], ["trash-plan", "trash"], ["restore-plan", "restore"]]) $("#" + id).addEventListener("click", safe(async () => {
    closeMenus();
    if (!await flush()) return;
    if(action==='trash' && store.kind==='files' && activeSpace?.layout==='files'){
      if(!current.relative_path){toast('尚未创建本地文件，无需删除。');return;}
      if(!window.confirm('删除这份本地文档？可在电脑系统回收站恢复。'))return;
      await window.LexiVaultSpace.request(`/api/workspaces/${activeSpace.id}/files/delete`,{method:'POST',body:JSON.stringify({path:current.relative_path})});
      await refreshLocalFiles();await explorer?.refresh();toast('已删除，可在电脑系统回收站恢复。');return;
    }
    if (action === "trash" && !window.confirm("将这份计划移到回收站？可以随时恢复。")) return;
    if (action === "archive") current.status = current.status === "archived" ? "draft" : "archived";
    else current.deletedAt = action === "trash" ? (/* @__PURE__ */ new Date()).toISOString() : null;
    dirty = true;
    changeVersion++;
    current.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    await saveDraft();
    $("#plan-filter").value = current.deletedAt ? "trash" : "all";
    fillFields();
    renderList();
    renderRelations();
  }));
  $("#import-button").addEventListener("click", () => openImport());
  $("#import-files").addEventListener("change", (e) => {
    selectedFiles = [...e.target.files];
    renderSelectedFiles();
  });
  $("#confirm-import").addEventListener("click", safe(runImport));
  $("#import-dialog").addEventListener("cancel", (e) => {
    if (busyImport) e.preventDefault();
  });
  $("#link-dialog").addEventListener("close", () => {
    linkRange = null;
  });
  $("#image-button").addEventListener("click", () => $("#image-files").click());
  $("#image-files").addEventListener("change", safe(async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type) || file.size > 5 * 1024 * 1024) throw new Error("正文图片支持 PNG / JPEG / GIF / WebP，最大 5 MiB。");
    if (!await flush()) return;
    const data = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(new Error("图片读取失败。"));
      r.readAsDataURL(file);
    });
    const original = attachment(file, current.id), p = clone(current);
    p.attachmentIds.push(original.id);
    current = await store.putPlan(p, p.revision, [original]);
    replacePlan(current);
    files.push(original);
    editor.chain().focus().setImage({ src: data, alt: file.name }).run();
    renderAttachments();
  }));
  $("#url-button").addEventListener("click", () => {
    linkRange = { from: editor.state.selection.from, to: editor.state.selection.to };
    $("#url-value").value = editor.getAttributes("link").href || "";
    $("#url-error").textContent = "";
    $("#url-dialog").showModal();
    $("#url-value").focus();
  });
  $("#apply-url").addEventListener("click", () => {
    const href = $("#url-value").value.trim();
    if (!/^(https?:\/\/[^\s]+|mailto:[^\s]+)$/i.test(href)) {
      $("#url-error").textContent = "请输入完整的 http、https 或 mailto 地址。";
      return;
    }
    const c = editor.chain().focus().setTextSelection(linkRange);
    if (linkRange.from === linkRange.to) c.insertContent({ type: "text", text: href, marks: [{ type: "link", attrs: { href } }] }).run();
    else c.setLink({ href }).run();
    $("#url-dialog").close();
  });
  $("#remove-url").addEventListener("click", () => {
    editor.chain().focus().setTextSelection(linkRange).extendMarkRange("link").unsetLink().run();
    $("#url-dialog").close();
  });
  $("#calendar-prev").addEventListener("click", () => {
    calendar = new Date(calendar.getFullYear(), calendar.getMonth() - 1, 1, 12);
    renderCalendar();
  });
  $("#calendar-next").addEventListener("click", () => {
    calendar = new Date(calendar.getFullYear(), calendar.getMonth() + 1, 1, 12);
    renderCalendar();
  });
  $("#calendar-today").addEventListener("click", () => {
    calendar = /* @__PURE__ */ new Date();
    renderCalendar();
  });
  $("#graph-search").addEventListener("input", drawGraph);
  $("#graph-reset").addEventListener("click", () => graphReset());
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeMenus();
      hideSuggestions();
      document.body.classList.remove("list-open");
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      safe(saveDraft)();
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k" && !e.isComposing && !$("dialog[open]")) {
      e.preventDefault();
      showLinkDialog();
    }
  });
  document.addEventListener("dragover", (e) => {
    if (e.dataTransfer?.types?.includes("Files")) {
      e.preventDefault();
      $(".plans-layout").classList.add("is-dragging");
    }
  });
  document.addEventListener("dragleave", (e) => {
    if (!e.relatedTarget) $(".plans-layout").classList.remove("is-dragging");
  });
  document.addEventListener("drop", (e) => {
    if (!e.dataTransfer?.files?.length) return;
    e.preventDefault();
    $(".plans-layout").classList.remove("is-dragging");
    if (busyImport) return;
    if ($("#import-dialog").open) {
      selectedFiles = [...e.dataTransfer.files];
      renderSelectedFiles();
    } else openImport(e.dataTransfer.files);
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && dirty) saveDraft().catch(showError);
  });
  window.addEventListener("beforeunload", (e) => {
    if (dirty || saving || busyImport) {
      e.preventDefault();
      e.returnValue = "";
    }
  });
  window.addEventListener("pagehide", () => {
    channel?.close();
    clearInterval(fileRefresh);
  });
  window.addEventListener('pageshow',event=>{if(event.persisted && store?.kind==='files'){clearInterval(fileRefresh);fileRefresh=setInterval(()=>void refreshLocalFiles(),2000);void refreshLocalFiles();}});
  $$("a[href]").filter((a) => !a.hasAttribute("download") && !a.getAttribute("href").startsWith("#")).forEach((a) => a.addEventListener("click", (e) => {
    if (e.defaultPrevented) return;
    if (dirty) {
      e.preventDefault();
      safe(async () => {
        if (await flush()) window.location.href = a.href;
      })();
    }
  }));
}
async function boot() {
  try {
    const space = window.LexiVaultSpace ? await window.LexiVaultSpace.ready : null;
    if (window.LexiVaultSpace && !space) throw new Error('请先在文献阅读页打开或创建工作空间。');
    const storeName = 'lexivault.plans.workspace.' + (space?.id || 'unselected');
    activeSpace=space;
    store = space ? await openFileStore(window.LexiVaultSpace,space,fromHTML) : await openStore(storeName);
    await store.seed();
    plans = await store.allPlans();
    files = await store.allFiles();
    const query=new URLSearchParams(window.location.search);
    const last = query.get('plan') || plans.find(p=>p.relative_path===query.get('file'))?.id || await store.getMeta("lastPlan");
    current = clone(plans.find((p) => p.id === last && !p.deletedAt) || plans.find((p) => !p.deletedAt) || plans[0] || newPlan());
    // The blank editor is a draft; a new workspace has no saved example plans.
    editor = createPlanEditor($("#plan-editor"), { doc: current.doc, getPlans: () => plans, onUpdate: () => {
      markDirty();
      toolbarState();
      updateSuggestions();
    }, onSelection: () => {
      toolbarState();
      updateSuggestions();
    }, onNavigate: (link) => safe(navigateWiki)(link), onKey: onEditorKey });
    removeSpaceGuard=window.LexiVaultSpace?.addSwitchGuard?.(async()=>{if(busyImport){toast('请等待文件导入完成后再切换工作空间。');return false;}return flush();});
    bind();
    fillFields();
    renderList();
    renderRelations();
    toolbarState();
    view("document");
    feedback(plans.length ? (store.kind==='files'?"已保存到本地":"已保存到此浏览器") : "空白计划 · 编辑后保存");
    if(store.kind==='files'){
      if(space.layout==='files'){
        $('#plan-filter option[value="trash"]')?.remove();if($('#plan-filter').value==='trash')$('#plan-filter').value='all';
        const list=$('#plan-list'),controls=$('.plan-list-controls'),index=document.createElement('details');index.className='vault-plan-index';
        const summary=document.createElement('summary');summary.textContent='按计划状态查看';index.append(summary);list.before(index);index.append(controls,list);
        const host=document.createElement('div');index.before(host);$('.plan-list-heading h2').textContent='工作空间文件';
        explorer=mountExplorer(host,{client:window.LexiVaultSpace,space,beforeChange:flush,onChange:refreshLocalFiles,onOpen:async entry=>{
          if(!await flush())return;
          if(entry.kind==='markdown'){plans=await store.allPlans();files=await store.allFiles();const plan=plans.find(p=>p.relative_path===entry.path);if(plan){current=null;await openPlan(plan.id);}}
          else if(entry.kind==='pdf' && entry.document_id)location.href='reader.html?document='+encodeURIComponent(entry.document_id);
          else if(entry.kind==='pdf')toast('PDF 暂时无法识别，请查看文件树下方提示。');
          else location.href=`/api/workspaces/${space.id}/files/content?path=${encodeURIComponent(entry.path)}`;
        }});
        $('#plan-search').addEventListener('input',event=>explorer.search(event.target.value));
      }
      localPath();
      fileRefresh=setInterval(()=>void refreshLocalFiles(),2000);
      window.addEventListener('focus',()=>void refreshLocalFiles());
      if(store.migrationCount)toast(`已把 ${store.migrationCount} 份浏览器计划保存到本地文件夹，浏览器原副本保留。`);
      if(store.migrationError){const notice=document.createElement('p');notice.className='quiet-text';notice.setAttribute('role','status');notice.textContent=store.migrationError;const originalBackup=document.createElement('button');originalBackup.type='button';originalBackup.textContent='导出浏览器原副本';originalBackup.addEventListener('click',safe(async()=>download(await store.browserBackup(),'LexiVault-浏览器计划原副本.zip')));notice.append(originalBackup);($('#paper-scroll .plan-paper') || $('#paper-scroll')).prepend(notice);}
      if(store.warnings.length)toast(store.warnings.map(w=>w.message).join('；'));
      const download=document.createElement('button');download.type='button';download.textContent='下载当前草稿';
      download.addEventListener('click',()=>{if(!current)return;const url=URL.createObjectURL(new Blob([markdown({...current,doc:editor.getJSON()})],{type:'text/markdown;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=current.title.replace(/[<>:"/\\|?*]/g,'_')+'.md';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
      const saveNow=document.createElement('button');saveNow.type='button';saveNow.textContent='保存当前草稿';saveNow.addEventListener('click',safe(saveDraft));
      $('#save-error').append(saveNow,download);
      const draft=recoverableDraft();if(draft){const disk=plans.find(p=>p.id===draft.id);current=draft;dirty=true;externalConflict=(disk?.revision || 0)!==draft.revision || !!disk?.missing || !!disk?.external_error;editor.commands.setContent(draft.doc,{emitUpdate:false});fillFields();showError(new Error('已恢复未保存草稿，请核对后保存或另存副本。'));}
    }
    if (typeof BroadcastChannel !== "undefined") {
      channel = new BroadcastChannel(storeName);
      channel.onmessage = safe(async () => {
        if(store.kind==='files'){await refreshLocalFiles();return;}
        if (dirty || saving || busyImport) {
          toast("其他页面有更新；当前草稿保留，保存冲突时可另存副本。");
          return;
        }
        const freshPlans = await store.allPlans(), freshFiles = await store.allFiles();
        if (dirty || saving || busyImport) return;
        plans = freshPlans;
        files = freshFiles;
        const id = current.id;
        current = null;
        await openPlan(id);
      });
    }
    return { editor, store, save: saveDraft, sync: refreshLocalFiles, open: openPlan, add: addPlan, import: runImport, get current() {
      return current;
    }, get plans() {
      return plans;
    }, get files() {
      return files;
    }, destroy() {
      clearTimeout(saveTimer);
      clearInterval(fileRefresh);
      removeSpaceGuard?.();
      explorer?.destroy();explorer=null;
      clearTimeout(toastTimer);
      channel?.close();
      editor.destroy();
      store.close();
    } };
  } catch (error) {
    feedback("计划文件未能打开", true);
    $("#paper-scroll").innerHTML = '<div class="plan-paper"><h2>暂时无法打开研究计划</h2><p class="quiet-text">' + esc(error.message) + '</p><p class="quiet-text">请重启 Python 服务后通过项目地址打开页面。浏览器中的原计划数据仍保留。</p></div>';
    throw error;
  }
}
const plansReady = boot();
plansReady.catch((error) => console.error("LexiVault plans:", error));
export {
  plansReady
};
