import { PROVIDERS, EXAMPLE_PAPERS } from './catalog.js';
export const STORAGE_KEY = 'lexivault.discovery.v1';
export const PAGE_SIZES = [5, 10, 20, 50];
const providerIds = new Set(PROVIDERS.map(p => p.id));
const paperIds = {has: id => EXAMPLE_PAPERS.some(p => p.id === id)};
const text = (v, n = 500) => typeof v === 'string' ? v.slice(0, n) : '';
export function initialState() {
  return { version: 1, sources: ['semantic', 'crossref', 'arxiv'], modes: Object.fromEntries(PROVIDERS.map(p => [p.id, p.modes[0][0]])), download: { path: '', platform: 'windows', layout: 'source-year', filename: 'title-year', metadataFallback: true }, filters: { query: '', from: 2021, to: 2026, types: ['article', 'review', 'preprint'], oa: false, sort: 'relevance' }, pageSize: 10, queue: [] };
}
export function restoreState(raw) {
  const d = initialState();
  if (!raw || typeof raw !== 'object' || raw.version !== 1) return d;
  if (Array.isArray(raw.sources)) d.sources = [...new Set(raw.sources.filter(id => providerIds.has(id)))];
  for (const p of PROVIDERS) if (p.modes.some(([id]) => id === raw.modes?.[p.id])) d.modes[p.id] = raw.modes[p.id];
  if (Array.isArray(raw.queue)) d.queue = [...new Set(raw.queue.filter(id => paperIds.has(id)))];
  if (PAGE_SIZES.includes(raw.pageSize)) d.pageSize = raw.pageSize;
  const dl = raw.download;
  if (dl && typeof dl === 'object') {
    d.download.path = text(dl.path);
    for (const [key, allowed] of Object.entries({ platform: ['windows', 'mac', 'linux'], layout: ['source-year', 'year', 'flat'], filename: ['title-year', 'doi-title'] })) if (allowed.includes(dl[key])) d.download[key] = dl[key];
    if (typeof dl.metadataFallback === 'boolean') d.download.metadataFallback = dl.metadataFallback;
  }
  const f = raw.filters;
  if (f && typeof f === 'object') {
    d.filters.query = text(f.query, 300);
    if (Number.isInteger(f.from) && f.from >= 1900 && f.from <= 2100) d.filters.from = f.from;
    if (Number.isInteger(f.to) && f.to >= d.filters.from && f.to <= 2100) d.filters.to = f.to;
    if (Array.isArray(f.types)) d.filters.types = [...new Set(f.types.filter(v => ['article', 'review', 'preprint'].includes(v)))];
    d.filters.oa = f.oa === true;
    if (['relevance', 'newest', 'oldest', 'title'].includes(f.sort)) d.filters.sort = f.sort;
  }
  if (d.filters.to < d.filters.from) d.filters.to = d.filters.from;
  return d;
}
// A whitelist, not a spread of application state: credentials and last plans
// can never accidentally enter localStorage through this function.
export function serializableState(state) { return restoreState({ version: 1, sources: state.sources, modes: state.modes, download: state.download, filters: state.filters, pageSize: state.pageSize, queue: state.queue }); }
export function visibleFields(provider, mode) { return provider.fields.filter(f => !f.modes || f.modes.includes(mode)); }
export function configurationIssues(ids, modes, credentials) {
  const issues = [];
  for (const p of PROVIDERS.filter(p => ids.includes(p.id))) {
    const mode = modes[p.id];
    for (const f of visibleFields(p, mode)) {
      const value = text(credentials[p.id]?.[f.id], 4096).trim();
      if (f.required?.includes(mode) && !value) issues.push({ source: p.id, field: f.id, message: `${p.name}：请填写${f.label}` });
      else if (value && f.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) issues.push({ source: p.id, field: f.id, message: `${p.name}：请输入有效的邮箱地址` });
      else if (f.id === 'tool' && value && /\s/.test(value)) issues.push({ source: p.id, field: f.id, message: 'PubMed / PMC：应用标识不能含空格' });
    }
  }
  return issues;
}
export function validatePath(path) {
  const v = text(path).trim();
  if (!v) return '请先配置下载路径。';
  if (/[\u0000-\u001f]/.test(v) || !/^(?:[A-Za-z]:[\\/]|\/|~\/|\.\/)/.test(v) || /(?:^|[\\/])\.\.(?:[\\/]|$)/.test(v)) return '请输入有效路径，例如 D:\\Research\\LexiVault、~/Research/LexiVault 或 ./downloads。';
  return '';
}
export function resultsFor(state) {
  const f = state.filters, terms = f.query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  let results = EXAMPLE_PAPERS.filter(p => p.sources.some(id => state.sources.includes(id)) && p.year >= f.from && p.year <= f.to && f.types.includes(p.type) && (!f.oa || p.oa) && terms.every(term => (p.title + ' ' + p.summary + ' ' + p.search).toLowerCase().includes(term)));
  if (f.sort === 'newest') results.sort((a, b) => b.year - a.year);
  if (f.sort === 'oldest') results.sort((a, b) => a.year - b.year);
  if (f.sort === 'title') results.sort((a, b) => a.title.localeCompare(b.title));
  return results;
}
// A facet ignores its own year restriction, while respecting all other filters.
// Include empty years so the histogram and both slider handles share one scale.
export function yearDistribution(state, bounds = {}) {
  const defaults = initialState().filters;
  const min = Math.max(1900, Math.min(bounds.min ?? defaults.from, defaults.from, state.filters.from, ...EXAMPLE_PAPERS.map(p => p.year)));
  const max = Math.min(2100, Math.max(bounds.max ?? defaults.to, defaults.to, state.filters.to, ...EXAMPLE_PAPERS.map(p => p.year)));
  const matches = resultsFor({ ...state, filters: { ...state.filters, from: 1900, to: 2100 } });
  const counts = new Map();
  for (const paper of matches) counts.set(paper.year, (counts.get(paper.year) || 0) + 1);
  return { min, max, bins: Array.from({ length: max - min + 1 }, (_, i) => ({ year: min + i, count: counts.get(min + i) || 0 })) };
}
// Pagination stays in the front end. Clamp the page after the result set shrinks.
export function paginateResults(results, requestedPage = 1, requestedSize = 10) {
  const pageSize = PAGE_SIZES.includes(requestedSize) ? requestedSize : 10;
  const total = results.length, totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(totalPages, Math.max(1, Number.isInteger(requestedPage) ? requestedPage : 1));
  const offset = (page - 1) * pageSize;
  return { items: results.slice(offset, offset + pageSize), page, pageSize, total, totalPages, start: total ? offset + 1 : 0, end: Math.min(offset + pageSize, total) };
}
export function queueSources(state) { return [...new Set(state.queue.flatMap(id => { const p = EXAMPLE_PAPERS.find(p => p.id === id); return p ? [p.sources.find(s => state.sources.includes(s)) || p.sources[0]] : []; }))]; }
export function buildDraft(state, destination, createdAt = new Date().toISOString()) {
  const folder = text(destination.folder, 160).trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').split('/').map(part => part.trim()).join('/');
  if (!state.queue.length) throw new Error('请先把文献加入获取队列。');
  const pathError = validatePath(state.download.path); if (pathError) throw new Error(pathError);
  const vaultName = text(destination.vaultName, 80).trim();
  if (!vaultName) throw new Error('请填写目标知识库名称。');
  if (!(destination.workspace_id && folder==='') && (folder.split('/').some(part => !part.trim() || part === '.' || part === '..' || /[:*?"<>|]/.test(part)) || !folder)) throw new Error('请输入有效的目标目录名称，可用 / 表示多层目录。');
  return { schemaVersion: 1, kind: 'lexivault.acquisition-draft', status: 'draft', execution: 'not-connected', exampleData: true, createdAt, query: text(state.filters.query, 300), output: { path: state.download.path.trim(), platform: state.download.platform, layout: state.download.layout, filename: state.download.filename, metadataFallback: state.download.metadataFallback }, destination: { vaultName, folder,...(destination.workspace_id?{workspace_id:text(destination.workspace_id,160)}:{}) }, sources: queueSources(state).map(id => ({ id, accessMode: state.modes[id] })), credentialsIncluded: false, papers: state.queue.map(id => { const p = EXAMPLE_PAPERS.find(p => p.id === id); return { exampleId: p.id, title: p.title, year: p.year, source: p.sources.find(s => state.sources.includes(s)) || p.sources[0], requested: p.oa ? ['metadata', 'available-open-fulltext'] : ['metadata'] }; }) };
}
export function restoreDraft(raw) {
  if (raw?.kind !== 'lexivault.acquisition-draft' || raw.schemaVersion !== 1 || !Array.isArray(raw.papers) || !Array.isArray(raw.sources)) return null;
  try {
    const state = restoreState({ version: 1, queue: raw.papers.map(p => p?.exampleId), sources: raw.sources.map(p => p?.id), modes: Object.fromEntries(raw.sources.filter(p => p && typeof p.id === 'string').map(p => [p.id, p.accessMode])), download: raw.output, filters: { query: raw.query } });
    return buildDraft(state, raw.destination || {}, text(raw.createdAt, 40));
  } catch { return null; }
}
