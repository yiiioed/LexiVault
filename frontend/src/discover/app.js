import { initSuite, icon } from '../suite.js';
import { PROVIDERS, EXAMPLE_PAPERS, TYPE_LABELS } from './catalog.js';
import { STORAGE_KEY, PAGE_SIZES, initialState, restoreState, restoreDraft, serializableState, visibleFields, configurationIssues, validatePath, resultsFor, paginateResults, queueSources, buildDraft } from './model.js';
import { createYearFilter } from './year-range.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

export function initDiscovery() {
  if (document.body.dataset.feature !== 'discover') return null;
  initSuite();
  const storageKey = STORAGE_KEY + '.' + (window.LexiVaultSpace?.current?.id || 'unselected');
  const draftKey = storageKey + '.draft';
  const d = document, w = window, q = s => d.querySelector(s), all = s => [...d.querySelectorAll(s)];
  const abort = new w.AbortController(), on = (el, type, fn) => el?.addEventListener(type, fn, { signal: abort.signal });
  let state = initialState(), credentials = defaultCredentials(), lastDraft = null, toastTimer, activeSource = 'semantic', returnToDestination = false, currentPage = 1;
  const focusOrigins = new Map();
  const realSpace=window.LexiVaultSpace?.current?.layout==='files'?window.LexiVaultSpace.current:null;
  let realFolder;
  try { state = restoreState(JSON.parse(w.localStorage.getItem(storageKey))); lastDraft = restoreDraft(JSON.parse(w.localStorage.getItem(draftKey))); } catch { /* usable without storage */ }
  const yearFilter = createYearFilter({ document: d, getState: () => state, onCommit: readFilters, signal: abort.signal });
  function defaultCredentials() { return Object.fromEntries(PROVIDERS.map(p => [p.id, Object.fromEntries(p.fields.map(f => [f.id, f.default || '']))])); }
  function saveState() {
    try { w.localStorage.setItem(storageKey, JSON.stringify(serializableState(state))); return true; }
    catch { const message = '设置在本页生效；浏览器阻止保存，刷新后可能不保留。'; q('#discovery-status').textContent = message; notify(message); return false; }
  }
  function notify(message) {
    const el = q('#suite-toast'); el.textContent = message; el.hidden = false;
    w.clearTimeout(toastTimer); toastTimer = w.setTimeout(() => { el.hidden = true; }, 4200);
  }
  function setError(id, message) { const el = q(id); el.textContent = message; el.hidden = !message; }
  function showDialog(id, focusId) {
    const dialog = q(id); focusOrigins.set(dialog, d.activeElement);
    all('dialog[open]').forEach(el => { if (el !== dialog) el.close(); });
    if (!dialog.open) dialog.showModal();
    q(focusId)?.focus();
  }
  for (const dialog of all('#source-config-dialog,#download-config-dialog,#acquisition-dialog')) on(dialog, 'close', () => {
    if (dialog.id === 'source-config-dialog') {
      for (const input of all('[data-credential-source]')) input.value = '';
      for (const button of all('[data-reveal-key]')) { const input = q('#' + button.dataset.revealKey); input.type = 'password'; button.textContent = '显示'; button.setAttribute('aria-pressed', 'false'); button.setAttribute('aria-label', '显示' + PROVIDERS.find(p => p.id === input.dataset.credentialSource).name + '密钥'); }
    }
    if (returnToDestination && dialog.id !== 'acquisition-dialog') { returnToDestination = false; openDestination(); }
    else focusOrigins.get(dialog)?.focus();
  });
  function updateSourceFields() {
    for (const p of PROVIDERS) {
      const mode = q('#source-mode-' + p.id).value;
      const visible = new Set(visibleFields(p, mode).map(f => f.id));
      for (const f of p.fields) {
        const input = q(`#source-${p.id}-${f.id}`), required = f.required?.includes(mode) === true;
        q(`[data-field-wrapper="${p.id}.${f.id}"]`).hidden = !visible.has(f.id);
        input.required = visible.has(f.id) && required;
        input.disabled = !visible.has(f.id);
        q(`[data-field-status="${p.id}.${f.id}"]`).textContent = required ? '必填' : '可选';
      }
    }
  }
  function selectSourceTab(id, focus = false) {
    activeSource = id;
    for (const p of PROVIDERS) {
      const button = q('#provider-tab-' + p.id), selected = p.id === id;
      button.setAttribute('aria-selected', String(selected)); button.tabIndex = selected ? 0 : -1;
      q('#provider-panel-' + p.id).hidden = !selected;
    }
    if (focus) q('#provider-tab-' + id).focus();
  }
  function openSources(fromDestination = false) {
    returnToDestination = fromDestination;
    for (const p of PROVIDERS) {
      q('#source-enable-' + p.id).checked = state.sources.includes(p.id);
      q('#source-mode-' + p.id).value = state.modes[p.id];
      for (const f of p.fields) q(`#source-${p.id}-${f.id}`).value = credentials[p.id]?.[f.id] || '';
    }
    setError('#source-config-error', ''); q('#source-config-memory-status').textContent = '';
    updateSourceFields(); updateSourceSelectionCount();
    const issues = configurationIssues([...new Set([...state.sources, ...queueSources(state)])], state.modes, credentials);
    selectSourceTab(issues[0]?.source || activeSource);
    showDialog('#source-config-dialog', '#provider-tab-' + activeSource);
  }
  function sourceStatus() {
    const ids = [...new Set([...state.sources, ...queueSources(state)])], issues = configurationIssues(ids, state.modes, credentials);
    const count = new Set(issues.map(i => i.source)).size;
    q('#source-settings-status').textContent = count ? `${state.sources.length} 个来源 · ${count} 项待填` : `已启用 ${state.sources.length} 个来源 · 管理凭据`;
    q('#source-settings').classList.toggle('needs-attention', count > 0);
    for (const p of PROVIDERS) q('#source-enable-' + p.id).title = p.scope + (issues.some(i => i.source === p.id) ? ' · 请补充来源配置' : '');
    return issues;
  }
  for (const button of all('[data-provider-tab]')) {
    on(button, 'click', () => selectSourceTab(button.dataset.providerTab));
    on(button, 'keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault(); const index = PROVIDERS.findIndex(p => p.id === activeSource);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? PROVIDERS.length - 1 : (index + (['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1) + PROVIDERS.length) % PROVIDERS.length;
      selectSourceTab(PROVIDERS[next].id, true);
    });
  }
  for (const select of all('[data-source-mode]')) on(select, 'change', () => { updateSourceFields(); setError('#source-config-error', ''); });
  for (const button of all('[data-reveal-key]')) on(button, 'click', () => {
    const input = q('#' + button.dataset.revealKey), reveal = input.type === 'password';
    input.type = reveal ? 'text' : 'password'; button.textContent = reveal ? '隐藏' : '显示'; button.setAttribute('aria-pressed', String(reveal));
    button.setAttribute('aria-label', (reveal ? '隐藏' : '显示') + PROVIDERS.find(p => p.id === input.dataset.credentialSource).name + '密钥');
  });
  on(q('#source-settings'), 'click', () => openSources());
  on(q('#source-config-form'), 'submit', event => {
    event.preventDefault();
    const modes = {}, values = {};
    for (const p of PROVIDERS) {
      modes[p.id] = q('#source-mode-' + p.id).value; values[p.id] = {};
      for (const f of p.fields) values[p.id][f.id] = q(`#source-${p.id}-${f.id}`).value.trim();
    }
    const sources = all('[data-source-enable]:checked').map(input => input.value);
    const ids = [...new Set([...sources, ...queueSources({ ...state, sources })])], issues = configurationIssues(ids, modes, values);
    if (issues.length) { const issue = issues[0]; selectSourceTab(issue.source); setError('#source-config-error', issue.message); q(`#source-${issue.source}-${issue.field}`).focus(); return; }
    state.sources = sources; state.modes = modes; credentials = values; sourceStatus(); const persisted = saveState();
    renderResults({ resetPage: true, resetScroll: true }); renderQueue();
    q('#source-config-dialog').close(); notify(persisted ? '来源配置已应用；凭据只保留在当前页面，未验证或连接网站。' : '来源配置在本页生效，浏览器未能保存设置。');
  });
  on(q('#clear-source-credentials'), 'click', () => {
    credentials = defaultCredentials();
    for (const p of PROVIDERS) for (const f of p.fields) q(`#source-${p.id}-${f.id}`).value = credentials[p.id][f.id];
    q('#source-config-memory-status').textContent = ' 已清除本页密钥和邮箱。'; setError('#source-config-error', ''); sourceStatus();
  });
  function pathFormValues() { return { path: q('#download-path').value.trim(), platform: q('#download-platform').value, layout: q('#download-layout').value, filename: q('#download-filename').value, metadataFallback: q('#download-metadata-fallback').checked }; }
  function updatePathPreview() {
    const v = pathFormValues(), sep = v.platform === 'windows' ? '\\' : '/';
    q('#download-path').placeholder = { windows: 'D:\\Research\\LexiVault', mac: '~/Documents/LexiVault', linux: '/home/you/Research/LexiVault' }[v.platform];
    const suffix = v.layout === 'source-year' ? ['来源', '2025'] : v.layout === 'year' ? ['2025'] : [];
    q('#download-preview').textContent = [v.path || '下载目录', ...suffix, (v.filename === 'doi-title' ? 'DOI_论文标题' : '论文标题_2025') + '.pdf'].join(sep);
  }
  function openPath(fromDestination = false) {
    returnToDestination = fromDestination;
    for (const key of ['platform', 'path', 'layout', 'filename']) q('#download-' + key).value = state.download[key];
    q('#download-metadata-fallback').checked = state.download.metadataFallback;
    setError('#download-config-error', ''); updatePathPreview(); showDialog('#download-config-dialog', '#download-path');
  }
  for (const id of ['path', 'platform', 'layout', 'filename']) on(q('#download-' + id), id === 'path' ? 'input' : 'change', updatePathPreview);
  on(q('#download-config-form'), 'submit', event => {
    event.preventDefault(); const values = pathFormValues(), error = validatePath(values.path);
    if (error) { setError('#download-config-error', error); q('#download-path').focus(); return; }
    state.download = values; const persisted = saveState(); q('#download-config-dialog').close(); notify(persisted ? '下载路径配置已保存，未创建目录或写入文件。' : '下载路径在本页生效，浏览器未能保存设置。');
  });
  function renderFacets() {
    const f = state.filters;
    q('#filter-type-summary').textContent = f.types.length === 3 ? '全部' : `已选 ${f.types.length} 项`;
    const typeResults = resultsFor({ ...state, filters: { ...f, types: ['article', 'review', 'preprint'] } });
    for (const el of all('[data-type-count]')) el.textContent = String(typeResults.filter(p => p.type === el.dataset.typeCount).length);
    yearFilter.render();
  }
  function renderPagination(paging) {
    q('#discovery-page-range').textContent = `${paging.start}–${paging.end} / ${paging.total} 篇`;
    const pages = [...new Set([1, paging.totalPages, paging.page - 1, paging.page, paging.page + 1])].filter(n => n > 0 && n <= paging.totalPages).sort((a, b) => a - b);
    const pageButtons = pages.map((page, i) => `${i && page - pages[i - 1] > 1 ? '<span class="d-page-gap" aria-hidden="true">…</span>' : ''}<button type="button" data-result-page="${page}" aria-label="第 ${page} 页"${page === paging.page ? ' aria-current="page"' : ''}>${page}</button>`).join('');
    q('#discovery-pagination').innerHTML = `<button type="button" class="d-page-prev" data-result-page="${paging.page - 1}" aria-label="上一页" ${paging.page === 1 ? 'disabled' : ''}>${icon('chevron')}</button>${pageButtons}<button type="button" class="d-page-next" data-result-page="${paging.page + 1}" aria-label="下一页" ${paging.page === paging.totalPages ? 'disabled' : ''}>${icon('chevron')}</button>`;
  }
  function renderResults({ resetPage = false, resetScroll = false } = {}) {
    const list = q('#discovery-results'), scrollTop = list.scrollTop;
    const expanded = new Set(all('.d-paper details[open]').map(el => el.closest('[data-result-id]').dataset.resultId));
    const results = resultsFor(state), paging = paginateResults(results, resetPage ? 1 : currentPage, state.pageSize);
    currentPage = paging.page;
    q('#discovery-result-count').textContent = `检索结果 ${paging.total} 篇 · 多来源合并`;
    list.innerHTML = paging.total ? paging.items.map(p => {
      const selected = state.queue.includes(p.id), source = PROVIDERS.find(s => s.id === (p.sources.find(id => state.sources.includes(id)) || p.sources[0]));
      return `<article class="d-paper" data-result-id="${p.id}"><h4>${esc(p.title)}</h4><div class="d-paper-meta"><span>示例作者 · ${p.year} · ${TYPE_LABELS[p.type]}</span><span class="d-paper-access${p.oa ? ' is-open' : ''}">${p.oa ? '开放获取' : '元数据'}</span></div><p class="d-paper-summary">${esc(p.summary)}</p><div class="d-paper-bottom"><div class="d-paper-tags">${p.tags.map(tag => `<span>${esc(tag)}</span>`).join('')}</div></div><details${!resetScroll && expanded.has(p.id) ? ' open' : ''}><summary>摘要与来源</summary><p>${esc(p.abstract)}</p><p>示例来源：${esc(source.name)} · <a href="https://${source.domain}" target="_blank" rel="noopener noreferrer">打开来源网站 ↗</a></p></details><button type="button" class="d-add-paper" data-toggle-paper="${p.id}" aria-pressed="${selected}" aria-label="${selected ? '移出' : '加入'}获取队列：${esc(p.title)}" title="${selected ? '移出获取队列' : '加入获取队列'}">${icon(selected ? 'task' : 'plus')}</button></article>`;
    }).join('') : `<div class="d-empty">${icon('search')}<strong>${state.sources.length ? '没有符合条件的检索结果' : '请至少选择一个检索来源'}</strong><p>可以调整年份、资料类型或关键词。<br>当前预览不会向文献网站发送检索请求。</p></div>`;
    list.scrollTop = resetScroll ? 0 : scrollTop;
    renderPagination(paging); renderFacets();
  }
  function renderQueue() {
    q('#queue-count').textContent = q('#queue-tab-count').textContent = String(state.queue.length); q('#confirm-acquisition').disabled = !state.queue.length;
    q('#discovery-queue').innerHTML = state.queue.length ? state.queue.map(id => {
      const p = EXAMPLE_PAPERS.find(p => p.id === id), source = PROVIDERS.find(s => s.id === (p.sources.find(s => state.sources.includes(s)) || p.sources[0]));
      return `<div class="d-queue-row">${icon('plan')}<div class="d-queue-copy"><h4 title="${esc(p.title)}">${esc(p.title)}</h4><p>${source.name} · ${p.oa ? '元数据 + 可用开放全文' : '元数据'}</p><p>示例条目 · 待确认</p></div><button class="d-remove-paper" type="button" data-remove-paper="${p.id}" aria-label="移除 ${esc(p.title)}" title="移出队列">${icon('close')}</button></div>`;
    }).join('') : `<div class="d-empty">${icon('plan')}<strong>留一个位置给好文献</strong><p>点击结果右侧的加号，<br>加入这次的获取队列。</p></div>`;
    sourceStatus();
  }
  function renderDraft() {
    const el = q('#discovery-draft-summary'); el.hidden = !lastDraft;
    if (lastDraft) el.innerHTML = `<strong>获取方案草稿 · ${lastDraft.papers.length} 篇</strong><span>${esc(lastDraft.destination.vaultName)} / ${esc(lastDraft.destination.folder)}</span><small>未执行下载或入库 · 不含任何凭据</small><button type="button" id="export-acquisition-draft">导出方案 JSON ↓</button>`;
  }
  function readFilters() {
    const from = Number(q('#discovery-year-from').value), to = Number(q('#discovery-year-to').value);
    const valid = Number.isInteger(from) && Number.isInteger(to) && from >= 1900 && to <= 2100 && from <= to;
    for (const id of ['from', 'to']) q('#discovery-year-' + id).setAttribute('aria-invalid', String(!valid));
    const error = valid ? '' : '请使用 1900—2100 之间的年份，结束年份不能早于起始年份。';
    q('#discovery-year-error').textContent = error; q('#discovery-year-error').hidden = !error;
    if (!valid) { q('#discovery-status').textContent = error; q('#discovery-year-precision').open = true; return false; }
    state.filters = { query: q('#discovery-query').value.trim(), from, to, types: all('[data-paper-type]:checked').map(input => input.value), oa: q('#filter-open-access').checked, sort: q('#discovery-sort').value };
    q('#discovery-status').textContent = '已按条件筛选检索结果；未向文献网站发起请求。'; saveState(); renderResults({ resetPage: true, resetScroll: true }); return true;
  }
  function reflectFilters() {
    const f = state.filters; q('#discovery-query').value = f.query;
    q('#discovery-year-from').value = f.from; q('#discovery-year-to').value = f.to; q('#discovery-sort').value = f.sort; q('#filter-open-access').checked = f.oa;
    for (const input of all('[data-paper-type]')) input.checked = f.types.includes(input.value);
    for (const input of all('[data-source-enable]')) input.checked = state.sources.includes(input.value);
    q('#discovery-page-size').value = String(state.pageSize);
  }
  function selectWorkspacePanel(panel) {
    q('.d-workspace').dataset.activePanel = panel;
    for (const button of all('[data-workspace-tab]')) {
      const selected = button.dataset.workspaceTab === panel;
      button.classList.toggle('is-active', selected); button.setAttribute('aria-pressed', String(selected));
    }
  }
  for (const button of all('[data-workspace-tab]')) on(button, 'click', () => selectWorkspacePanel(button.dataset.workspaceTab));
  on(q('#discovery-page-size'), 'change', () => {
    const size = Number(q('#discovery-page-size').value);
    if (!PAGE_SIZES.includes(size)) return;
    state.pageSize = size; saveState(); renderResults({ resetPage: true, resetScroll: true });
  });
  on(q('#discovery-pagination'), 'click', event => {
    const button = event.target.closest('[data-result-page]');
    if (!button || button.disabled) return;
    currentPage = Number(button.dataset.resultPage); renderResults({ resetScroll: true });
    q(`[data-result-page="${currentPage}"][aria-current]`)?.focus({ preventScroll: true });
  });
  on(q('#discovery-search-form'), 'submit', event => { event.preventDefault(); if (readFilters()) selectWorkspacePanel('results'); });
  for (const el of all('[data-paper-type],#filter-open-access,#discovery-sort,#discovery-year-from,#discovery-year-to')) on(el, 'change', readFilters);
  function updateSourceSelectionCount() { q('#source-selection-count').textContent = `已选 ${all('[data-source-enable]:checked').length} 个`; }
  for (const input of all('[data-source-enable]')) on(input, 'change', updateSourceSelectionCount);
  on(q('#reset-discovery-filters'), 'click', () => { state.filters = initialState().filters; yearFilter.resetDomain(); reflectFilters(); readFilters(); });
  function togglePaper(id, remove = false) {
    if (!EXAMPLE_PAPERS.some(p => p.id === id)) return;
    if (remove || state.queue.includes(id)) state.queue = state.queue.filter(v => v !== id); else state.queue.push(id);
    saveState(); renderResults(); renderQueue();
  }
  on(q('#discovery-results'), 'click', e => { const b = e.target.closest('[data-toggle-paper]'); if (b) { const id = b.dataset.togglePaper; togglePaper(id); q(`[data-toggle-paper="${id}"]`)?.focus(); } });
  on(q('#discovery-queue'), 'click', e => { const b = e.target.closest('[data-remove-paper]'); if (b) { const id = b.dataset.removePaper; togglePaper(id, true); (q(`[data-toggle-paper="${id}"]`) || q('[data-remove-paper]') || q('#discovery-query'))?.focus(); } });
  function workspaceName() { return q('[data-workspace-name]')?.textContent?.trim() || '选择工作空间'; }
  function destinationValues() {
    if(realSpace)return {vaultName:realSpace.name,folder:realFolder?.value||'',workspace_id:realSpace.id};
    const choice = q('#destination-vault').value, folderChoice = q('input[name="destination-folder"]:checked').value;
    return { vaultName: choice === 'custom' ? q('#destination-name').value : choice === 'methods' ? '方法与综述' : workspaceName(), folder: folderChoice === 'custom' ? q('#destination-folder-name').value : folderChoice };
  }
  function destinationPreview() {
    q('#destination-name-field').hidden = q('#destination-vault').value !== 'custom';
    q('#destination-folder-field').hidden = q('input[name="destination-folder"]:checked').value !== 'custom';
    const v = destinationValues(); q('#destination-preview').textContent = `${v.vaultName.trim() || '知识库名称'} / ${v.folder.trim() || '目录名称'}`;
  }
  async function openDestination() {
    if (!state.queue.length) return;
    if(realSpace){
      const tree=await window.LexiVaultSpace.request(`/api/workspaces/${realSpace.id}/files`);
      realFolder.replaceChildren(new Option('工作空间根目录',''));tree.entries.filter(e=>e.kind==='folder').forEach(e=>realFolder.add(new Option(e.path,e.path)));realFolder.value=window.LexiVaultSpace.directory||'';if(realFolder.selectedIndex<0)realFolder.value='';
      state.download.path=realSpace.path;state.download.layout='flat';
    }
    q('#destination-vault option[value=current]').textContent = workspaceName();
    q('#acquisition-count').textContent = `本次选择 ${state.queue.length} 篇`;
    q('#acquisition-download-path').textContent = state.download.path || '尚未配置下载路径';
    const issues = configurationIssues(queueSources(state), state.modes, credentials);
    q('#acquisition-config-status').textContent = issues.length ? `来源配置：${issues[0].message}` : '来源填写项齐全 · 未验证账号或 Key 的有效性';
    setError('#acquisition-error', ''); destinationPreview(); showDialog('#acquisition-dialog', '#destination-vault'); focusOrigins.set(q('#acquisition-dialog'), q('#confirm-acquisition'));
  }
  on(q('#confirm-acquisition'), 'click', openDestination);
  on(q('#acquisition-fix-path'), 'click', () => openPath(true));
  on(q('#acquisition-fix-sources'), 'click', () => openSources(true));
  for (const el of all('#destination-vault,input[name="destination-folder"]')) on(el, 'change', destinationPreview);
  for (const el of all('#destination-name,#destination-folder-name')) on(el, 'input', destinationPreview);
  on(q('#acquisition-form'), 'submit', event => {
    event.preventDefault(); const issues = configurationIssues(queueSources(state), state.modes, credentials);
    if (issues.length) { setError('#acquisition-error', issues[0].message + '。请点击“配置来源凭据”补充；这里只校验填写项。'); return; }
    let draft;
    try { draft = buildDraft(state, destinationValues()); } catch (error) { setError('#acquisition-error', error.message); return; }
    lastDraft = draft; let persisted = true;
    try { w.localStorage.setItem(draftKey, JSON.stringify(draft)); } catch { persisted = false; }
    renderDraft(); q('#acquisition-dialog').close(); notify(persisted ? '获取方案草稿已保存；未执行爬取、下载或入库。' : '方案已生成，可立即导出；浏览器未能保存草稿。');
  });
  on(q('#discovery-draft-summary'), 'click', e => {
    if (!e.target.closest('#export-acquisition-draft') || !lastDraft) return;
    const blob = new w.Blob([JSON.stringify(lastDraft, null, 2)], { type: 'application/json' }), url = w.URL.createObjectURL(blob), link = d.createElement('a');
    link.href = url; link.download = 'LexiVault-acquisition-draft.json'; link.click(); w.setTimeout(() => w.URL.revokeObjectURL(url), 1500);
  });
  if(realSpace){
    const vault=q('#destination-vault');for(const option of [...vault.options])if(option.value!=='current')option.remove();
    q('.d-folder-options').hidden=true;realFolder=d.createElement('select');realFolder.id='destination-real-folder';const label=d.createElement('label');label.htmlFor=realFolder.id;label.textContent='工作空间目录';q('.d-folder-options').after(label,realFolder);on(realFolder,'change',destinationPreview);
    state.download.path=realSpace.path;state.download.layout='flat';q('#download-path').readOnly=true;q('#download-layout').value='flat';q('#download-layout').disabled=true;
    const help=d.createElement('p');help.textContent='下载到当前工作空间，在入库位置中选择已有文件夹。新文件夹可在知识库管理中创建。';q('#download-path').after(help);
  }
  reflectFilters(); renderResults(); renderQueue(); renderDraft(); updateSourceFields();
  return { snapshot: () => serializableState(state), get lastDraft() { return lastDraft ? JSON.parse(JSON.stringify(lastDraft)) : null; }, destroy() { abort.abort(); w.clearTimeout(toastTimer); credentials = defaultCredentials(); all('[data-credential-source]').forEach(input => { input.value = ''; }); } };
}
export const discoveryApp = typeof document !== 'undefined' && document.body.dataset.feature === 'discover' ? (window.LexiVaultSpace?.ready || Promise.resolve()).then(() => initDiscovery()) : null;
