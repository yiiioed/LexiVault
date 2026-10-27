// Requirements checked against the linked official documentation on 2026-10-16.
// These describe future adapters; this frontend never calls a provider API.
export const PROVIDERS = [
  {
    id: 'semantic', name: 'Semantic Scholar', short: 'S2', domain: 'semanticscholar.org',
    scope: '跨学科论文、摘要与引用关系', access: '开放全文链接（如有）',
    description: '适合从一个研究主题出发，查找论文、摘要、作者与引用关系。API 返回的开放全文链接是否可用，仍取决于原文来源。',
    modes: [['public', '公开检索 · 无需 Key'], ['key', '使用个人 API Key']],
    fields: [{ id: 'key', label: 'Semantic Scholar API Key', type: 'password', modes: ['key'], required: ['key'], placeholder: '填写你申请到的 API Key', help: '在官方开发者页面申请，通过邮件领取；这里不需要网站登录密码。' }],
    note: '大部分检索接口允许匿名访问；部分接口要求 Key。官方建议携带 Key，初始额度通常为每秒 1 次请求。',
    docs: 'https://www.semanticscholar.org/product/api', setup: 'https://www.semanticscholar.org/product/api#api-key-form',
    setupLabel: '申请 API Key', technical: 'Academic Graph API；x-api-key 请求头。'
  },
  {
    id: 'crossref', name: 'Crossref', short: 'Cr', domain: 'crossref.org',
    scope: '跨学科 DOI、出版信息与部分摘要', access: '以元数据为主',
    description: '适合发现期刊与会议文献、核对 DOI 和出版信息。Crossref 提供元数据；有 DOI 或出版商链接，不代表可以直接下载全文。',
    modes: [['public', '公共接口 · 无需账号'], ['polite', 'Polite 接口 · 联系邮箱'], ['plus', 'Metadata Plus · 订阅 Token']],
    fields: [
      { id: 'email', label: '联系邮箱', type: 'email', modes: ['polite'], required: ['polite'], placeholder: 'researcher@example.edu', help: '作为 mailto 联系信息，用于 Polite 访问方式，不是登录账号。' },
      { id: 'key', label: 'Metadata Plus API Token', type: 'password', modes: ['plus'], required: ['plus'], placeholder: '填写你的 Plus 订阅 Token', help: '仅 Metadata Plus 订阅者需要；普通公共检索无需购买或填写。' }
    ],
    note: '公共接口无需注册；Polite 方式提供联系邮箱；Metadata Plus 方式需要订阅者自己的 Token。',
    docs: 'https://www.crossref.org/documentation/retrieve-metadata/rest-api/access-and-authentication/', setup: 'https://www.crossref.org/documentation/metadata-plus/metadata-plus-keys/',
    setupLabel: '了解 Plus Token', technical: 'REST API；mailto；Plus 使用 Crossref-Plus-API-Token 请求头。'
  },
  {
    id: 'arxiv', name: 'arXiv', short: 'aX', domain: 'arxiv.org',
    scope: '计算机、数学、物理等领域预印本', access: '预印本与原文链接',
    description: '适合跟进计算机、物理、数学等领域的新工作。公开 API 可检索题名、摘要、分类与原文链接，无需提供账号或 API Key。',
    modes: [['public', '公开 API · 无需任何凭据']], fields: [],
    note: '公开 API 无需 Key。传统 API 每次请求至少间隔 3 秒，同时仅使用一个连接；批量元数据另有 OAI-PMH 服务。',
    docs: 'https://info.arxiv.org/help/api/user-manual.html', setup: 'https://info.arxiv.org/help/api/tou.html',
    setupLabel: '访问频率说明', technical: 'Atom 查询 API；无需认证。'
  },
  {
    id: 'openalex', name: 'OpenAlex', short: 'OA', domain: 'openalex.org',
    scope: '跨学科文献、作者与机构索引', access: '开放获取位置（如有）',
    description: '适合覆盖较广的主题检索与文献关系发现。基础查询可不带 Key；使用游标继续批量获取时，需要已激活的免费 API Key。',
    modes: [['basic', '基础查询 · Key 可选'], ['cursor', '游标批量获取 · 需要 Key']],
    fields: [{ id: 'key', label: 'OpenAlex API Key', type: 'password', required: ['cursor'], placeholder: '填写已完成邮箱激活的 Key', help: '登录 OpenAlex 后在设置中复制 API Key；游标批量获取需要 Key，基础查询可留空。' }],
    note: '免费 Key 可提高日额度；Key 需完成邮箱激活。索引记录并不等于开放全文，全文仅按可用位置和许可获取。',
    docs: 'https://help.openalex.org/api/authentication/', setup: 'https://openalex.org/settings/api',
    setupLabel: '打开 API Key 设置', technical: 'Works API；api_key 参数或 Authorization: Bearer；游标翻页需 Key。'
  },
  {
    id: 'pubmed', name: 'PubMed / PMC', short: 'PM', domain: 'ncbi.nlm.nih.gov',
    scope: '生物医学文献与 PMC 开放全文', access: 'PubMed 元数据 / PMC OA 子集',
    description: 'PubMed 用于生物医学题录与摘要检索，PMC 中符合条件的开放获取子集用于全文。不是所有 PubMed 记录或 PMC 文章都能批量下载全文。',
    modes: [['standard', '标准访问 · 无需 Key'], ['key', '使用 NCBI API Key']],
    fields: [
      { id: 'tool', label: '应用标识（tool）', type: 'text', default: 'LexiVault', required: ['standard', 'key'], placeholder: 'LexiVault', help: '标识运行此项目的软件名称，不含空格。' },
      { id: 'email', label: '部署维护者邮箱（建议）', type: 'email', placeholder: 'maintainer@example.edu', help: 'NCBI 联系的是软件开发或部署维护者，非普通使用者的登录账号。' },
      { id: 'key', label: 'NCBI API Key', type: 'password', modes: ['key'], required: ['key'], placeholder: '填写 NCBI 账号设置中的 API Key', help: '标准访问可不填；选择 Key 方式后填写个人 NCBI API Key。' }
    ],
    note: '标准 E-utilities 每秒不超过 3 次请求，携带 Key 默认每秒最多 10 次。PMC 全文只使用官方允许的接口及符合许可的内容。',
    docs: 'https://www.ncbi.nlm.nih.gov/sites/books/NBK25497/', setup: 'https://www.ncbi.nlm.nih.gov/account/settings/',
    setupLabel: '打开 NCBI 账号设置', technical: 'E-utilities；tool、email、api_key；PMC OA 全文另走官方服务。'
  }
];

// Original design content, intentionally synthetic. No live search results,
// invented DOI, citation totals, downloaded files or indexing states are implied.
// Search results start empty until a real provider is connected.
export const EXAMPLE_PAPERS = [];
export const TYPE_LABELS = { article: '期刊与会议论文', review: '综述论文', preprint: '预印本' };
