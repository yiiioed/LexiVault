# LexiVault 资料来源与核验记录

核验日期：2026-10-15；草稿恢复：2026-10-16。只使用产品、项目维护方或原始论文等一手资料。以下链接用于解释设计依据，并不代表 LexiVault 已接入这些服务。API 字段、认证、配额、许可证与版本仍应在实际接入时再次核对。

| 编号 | 一手来源 | 本次核对的事实 | 对本项目的影响 |
| --- | --- | --- | --- |
| S01 | [Obsidian Internal links](https://obsidian.md/help/links) | 支持 wikilink 和 Markdown 内部链接，可定位文件、标题及特定块 | 计划可输入 `[[标题]]`；稳定 ID、同名处理和重命名策略由 LexiVault 自行实现 |
| S02 | [Obsidian Backlinks](https://obsidian.md/help/plugins/backlinks) | 反向链接表达其他笔记到当前笔记的引用，区分已链接和未链接提及 | 反链应由出链推导；本轮不把未链接提及伪装成明确链接 |
| S03 | [Obsidian Graph view](https://obsidian.md/help/plugins/graph) | 节点代表笔记，边代表内部链接；有筛选、分组、局部图和深度 | 研究计划关系图表达用户手动组织，与摘要关键词图采用不同关系语义 |
| S04 | [Crossref REST API](https://www.crossref.org/documentation/retrieve-metadata/rest-api/) | 提供成员及可信来源登记的学术元数据，可含摘要、许可与更新信息；有些摘要仍受版权约束 | 用于 DOI 和元数据，不承诺每项有全文；保存来源与许可，处理字段缺失 |
| S05 | [OpenAlex API reference](https://help.openalex.org/api/) | REST API 可对作品等实体进行检索、过滤、排序、分页和字段选择；外部文本需要安全处理 | 实现可替换来源适配器、分页、错误与 XSS 防护，不写死旧文档假设 |
| S06 | [OpenAlex Works](https://help.openalex.org/data/works/) | 作品有多种类型与位置，包含题名、摘要及相关学术实体 | 作品与文件／版本分层，跨库不复制作品主体 |
| S07 | [OpenAlex Authentication](https://help.openalex.org/api/authentication/) | 当前有无密钥基本使用与密钥预算，存在速率和分页条件；文档会更新 | 配额做配置化和退避，不在说明中承诺无限调用或固定永久免费 |
| S08 | [OpenAlex 维护的 Unpaywall 说明](https://help.openalex.org/access/unpaywall/) · [Unpaywall API](https://unpaywall.org/products/api) | Unpaywall 根据 DOI 返回开放副本线索，不是通用检索或全文编辑器 | DOI 已知时定位副本；保存版本与许可；没有开放文件时保留元数据 |
| S09 | [Semantic Scholar Academic Graph API](https://api.semanticscholar.org/api-docs/) | 官方 API 文档列出论文、摘要与作者等图数据端点 | 作为补充元数据来源；本次直接读取部分受 429／403 限制，仅将官方搜索可见的能力纳入方案，具体字段与授权需接入时再验 |
| S10 | [Neo4j 搜索索引](https://neo4j.com/docs/cypher-manual/current/indexes/semantic-indexes/) · [全文索引](https://neo4j.com/docs/cypher-manual/current/indexes/semantic-indexes/full-text-indexes/) · [向量索引](https://neo4j.com/docs/cypher-manual/current/indexes/search-indexes/vector-indexes/) | 全文与向量检索可组合，但分数语义不同，当前文档说明独立排序再融合 | 以排名融合设计混合检索；Neo4j 版本锁定后选择对应 Cypher 语法 |
| S11 | [Neo4j GraphRAG Python 使用指南](https://neo4j.com/docs/neo4j-graphrag-python/current/user_guide_rag.html) | 典型 RAG 流程由数据库驱动、检索器与生成模型组成，检索器可替换 | 本项目将检索与模型适配分离，图查询不直接交给前端或不受限模型执行 |
| S12 | [Lewis 等：Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks](https://arxiv.org/abs/2005.11401) | 原始研究将生成模型与外部可检索记忆结合 | 支持 RAG 技术路线；论文结果不能直接当作 LexiVault 的实际效果 |
| S13 | [GROBID Introduction](https://grobid.readthedocs.io/en/latest/Introduction/) | 针对科研文献从 PDF 提取结构化 TEI，覆盖头部、摘要、正文、参考文献和坐标等 | 列为后续后端解析候选，需要自己的领域样本评测，不承诺扫描件直接准确解析 |
| S14 | [MDN IndexedDB API](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API) | 浏览器事务型结构化存储，支持 Blob；受同源与配额影响 | 适合本轮试用；必须导出备份，不能声称等于任意磁盘目录持久化 |
| S15 | [SQLite Appropriate Uses](https://www.sqlite.org/whentouse.html) | SQLite 适合本地应用／设备数据和应用文件格式，与集中式数据库定位不同 | 后续单机主业务数据库使用 SQLite；多人同步服务另行设计 |
| S16 | [Tiptap Editor 官方文档](https://tiptap.dev/docs/editor/getting-started/overview) | 官方编辑器入口，可核对文档模型和扩展能力 | 本轮采用 Tiptap v3；具体扩展、导入能力和版本以源码为准，未把“使用编辑器”视作已有完整 Word 排版能力 |

## 检索边界

- 没有引用用户之前上传的项目文档，也没有把第三方博客方案直接当作需求。
- Obsidian 只作为内部链接与图谱交互的参考；LexiVault 的功能取舍由用户本次场景决定。
- OpenAlex 的旧文档网址已重定向；规范使用此次可读取的新官方 Help Center 地址。具体费率和瞬时配额没有写成永久产品承诺。
- Semantic Scholar 官方文档在本次直接打开时出现访问限流，因此未依赖任何未成功读取的具体费率、摘要覆盖率或批量上限。
- 文献获取、解析、图数据库和模型系统尚需真实接入及评测。本轮页面原型和本地研究计划不会被描述成这些服务已经上线。

## 自主设计与证据的区别

六模块导航、三列阅读布局、导入原件保留、计划数据模型、SQLite 主事实与 Neo4j 查询投影、关键词图谱交互预算、分阶段路线和验收矩阵，均为针对 LexiVault 的工程设计。它们是可讨论、可测试的方案，并非引用资料已经替本项目验证过的结论。
