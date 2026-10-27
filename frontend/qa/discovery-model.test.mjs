import test from 'node:test';
import assert from 'node:assert/strict';
import { PROVIDERS, EXAMPLE_PAPERS } from '../src/discover/catalog.js';
import { initialState as emptyInitialState, restoreState, serializableState, visibleFields, configurationIssues, validatePath, resultsFor, yearDistribution, paginateResults, buildDraft, restoreDraft } from '../src/discover/model.js';
import { PAPER_FIXTURES } from './discovery-fixtures.mjs';
EXAMPLE_PAPERS.push(...PAPER_FIXTURES);
const initialState = () => ({...emptyInitialState(),queue:['molecular-review','self-supervised-graph'],filters:{...emptyInitialState().filters,query:'graph neural networks molecular pretraining'}});

test('five providers have distinct documented public and credential requirements',()=>{
 assert.equal(PROVIDERS.length,5);assert.equal(PROVIDERS.find(p=>p.id==='arxiv').fields.length,0);
 const p=PROVIDERS.find(p=>p.id==='crossref');assert.deepEqual(visibleFields(p,'polite').map(f=>f.id),['email']);assert.deepEqual(visibleFields(p,'plus').map(f=>f.id),['key']);
 assert.equal(configurationIssues(['openalex'],{openalex:'basic'},{}).length,0);
 assert.equal(configurationIssues(['openalex'],{openalex:'cursor'},{}).length,1);
 assert.equal(configurationIssues(['openalex'],{openalex:'cursor'},{openalex:{key:'my-key'}}).length,0);
});
test('key and email modes validate only relevant fields without claiming remote validation',()=>{
 assert.equal(configurationIssues(['crossref'],{crossref:'public'},{crossref:{email:'bad'}}).length,0);
 assert.equal(configurationIssues(['crossref'],{crossref:'polite'},{crossref:{email:'bad'}}).length,1);
 assert.equal(configurationIssues(['crossref'],{crossref:'polite'},{crossref:{email:'a@university.edu'}}).length,0);
 assert.equal(configurationIssues(['semantic'],{semantic:'key'},{semantic:{key:''}}).length,1);
 assert.equal(configurationIssues(['pubmed'],{pubmed:'standard'},{pubmed:{tool:'Lexi Vault'}}).length,1);
 assert.equal(configurationIssues(['pubmed'],{pubmed:'standard'},{pubmed:{tool:'LexiVault'}}).length,0);
});
test('restoring preferences discards arbitrary data, unknown modes, duplicate papers and secrets',()=>{
 const s=restoreState({version:1,sources:['arxiv','arxiv','attacker'],modes:{arxiv:'password'},queue:['molecular-review','molecular-review','missing'],credentials:{key:'PRIVATE'},download:{path:'./papers',key:'PRIVATE'},filters:{query:'hello',from:2099,to:1900}});
 assert.deepEqual(s.sources,['arxiv']);assert.deepEqual(s.queue,['molecular-review']);assert.equal(s.modes.arxiv,'public');assert.equal(s.filters.from,s.filters.to);assert.doesNotMatch(JSON.stringify(s),/PRIVATE|attacker/);
 s.credentials={key:'PRIVATE'};assert.doesNotMatch(JSON.stringify(serializableState(s)),/PRIVATE/);
});
test('search combines source, year, type and open access filters on finite examples',()=>{
 const s=initialState();assert.equal(resultsFor(s).length,5);s.filters.query='';s.sources=['arxiv'];assert.deepEqual(resultsFor(s).map(p=>p.id),['self-supervised-graph']);
 s.sources=['semantic','crossref'];s.filters.oa=true;assert.ok(resultsFor(s).every(p=>p.oa));s.filters.from=2025;s.filters.to=2025;assert.equal(resultsFor(s).length,1);
 s.filters.types=[];assert.equal(resultsFor(s).length,0);
});
test('pagination covers every result once and clamps invalid pages after filtering',()=>{
 const papers=Array.from({length:123},(_,i)=>({id:i}));
 const pages=Array.from({length:13},(_,i)=>paginateResults(papers,i+1,10));
 assert.deepEqual(pages.flatMap(p=>p.items),papers);
 assert.deepEqual([pages.at(-1).start,pages.at(-1).end,pages.at(-1).totalPages],[121,123,13]);
 assert.equal(paginateResults(papers,999,20).page,7);
 assert.equal(paginateResults(papers,-2,10).page,1);
 assert.equal(paginateResults(papers,NaN,999).pageSize,10);
 const empty=paginateResults([],5,5);assert.equal(empty.items.length,0);assert.deepEqual([empty.page,empty.totalPages,empty.start,empty.end],[1,1,0,0]);
 assert.equal(paginateResults(papers.slice(0,2),13,10).page,1);
});
test('year distribution keeps empty years and ignores only its own year restriction',()=>{
 const s=initialState();s.filters.from=2024;s.filters.to=2024;
 const facet=yearDistribution(s);assert.deepEqual([facet.min,facet.max],[2021,2026]);assert.deepEqual(facet.bins.map(b=>b.count),[1,1,1,1,1,0]);
 s.sources=['openalex'];s.filters.oa=true;
 const next=yearDistribution(s,{min:2002,max:2026});assert.equal(next.bins.length,25);assert.equal(next.bins.find(b=>b.year===2024).count,0);assert.equal(next.bins.find(b=>b.year===2025).count,2);
 s.filters.query='nothing';assert.ok(yearDistribution(s).bins.every(b=>b.count===0));
});
test('page size preferences restore from the whitelist and remain compatible with older saved state',()=>{
 assert.equal(restoreState({version:1,pageSize:20}).pageSize,20);
 assert.equal(restoreState({version:1,pageSize:50000}).pageSize,10);
 assert.equal(restoreState({version:1}).pageSize,10);
 const s=initialState();s.pageSize=50;assert.equal(serializableState(s).pageSize,50);
});
test('download paths accept local configuration formats and reject URLs or traversal',()=>{
 for(const path of ['D:\\Research\\LexiVault','/home/user/papers','~/Documents/papers','./downloads'])assert.equal(validatePath(path),'');
 for(const path of ['', 'https://website/path','javascript:alert(1)','../papers','./papers/../other','/home/\nsecret'])assert.ok(validatePath(path));
});
test('draft separates raw download path from vault location and includes no credential payload',()=>{
 const s=initialState();s.download.path='D:\\Research\\Papers';s.download.key='PRIVATE';s.credentials={semantic:{key:'PRIVATE'}};
 const draft=buildDraft(s,{vaultName:'课题资料',folder:'2026/精读'},'2026-10-16T06:26:53Z');
 assert.equal(draft.output.path,'D:\\Research\\Papers');assert.deepEqual(draft.destination,{vaultName:'课题资料',folder:'2026/精读'});assert.equal(draft.status,'draft');assert.equal(draft.execution,'not-connected');assert.equal(draft.exampleData,true);assert.equal(draft.credentialsIncluded,false);assert.doesNotMatch(JSON.stringify(draft),/PRIVATE/);
 assert.ok(draft.papers.every(p=>EXAMPLE_PAPERS.some(e=>e.id===p.exampleId)));
});
test('draft requires a queue, path and valid destination and restores only validated fields',()=>{
 const s=initialState();assert.throws(()=>buildDraft(s,{vaultName:'A',folder:'待读'}),/下载路径/);s.download.path='./papers';
 assert.throws(()=>buildDraft(s,{vaultName:'',folder:'待读'}),/知识库/);assert.throws(()=>buildDraft(s,{vaultName:'A',folder:'../escape'}),/目录/);
 const draft=buildDraft(s,{vaultName:'A',folder:'待读'});draft.token='PRIVATE';draft.output.secret='PRIVATE';assert.doesNotMatch(JSON.stringify(restoreDraft(draft)),/PRIVATE/);
 assert.equal(restoreDraft({kind:'unknown'}),null);s.queue=[];assert.throws(()=>buildDraft(s,{vaultName:'A',folder:'待读'}),/队列/);
});
