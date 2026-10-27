# 文献发现：来源配置与前端试用

本页对应 v0.4.2 的 `discover.html`。来源规则沿用 v0.4.0；本次只调整前端布局与交互。页面保留暖色日夜主题与“筛选—检索结果—获取队列”的设计，使用真实 HTML、CSS 和本地交互。

当前不包含爬取程序、远程检索、凭据验证、文件下载或知识库写入。题录、作者提示与摘要是明确标注的本地界面示例，没有伪造 DOI、下载成功或入库完成状态。来源网站的数据规模与全文覆盖会变化，因此界面不使用未经实时统计的文献总量。

## 五个来源与需要填写的信息

| 来源 | 用途与可获取内容 | 前端访问方式与填写项 | 全文边界 |
| --- | --- | --- | --- |
| Semantic Scholar | 跨学科论文、摘要、作者与引用关系；部分记录提供开放 PDF 链接 | 公开检索无需 Key；选择个人 Key 方式后填写 **Semantic Scholar API Key** | 开放全文链接不代表所有论文都能下载；部分接口需要认证 |
| Crossref | 跨学科 DOI、期刊会议出版元数据与部分摘要 | Public 无需账号；Polite 填 **联系邮箱**；Metadata Plus 填自己的 **订阅 API Token** | 元数据服务不等于全文库，有 DOI 不等于已获得全文权限 |
| arXiv | 计算机、物理、数学等领域预印本及其原文链接 | **无需账号、密码或 API Key** | 按 arXiv 接口及原文许可获取；传统 API 至少间隔 3 秒、单连接 |
| OpenAlex | 广泛的跨学科作品、作者、机构和开放获取位置索引 | 基础查询 Key 可选；选择 **游标批量获取** 后必须填写已激活的 **OpenAlex API Key** | 索引中存在文献不保证存在可下载全文 |
| PubMed / PMC | PubMed 生物医学题录与摘要，PMC 合适的开放全文子集 | 标准方式无需 Key；Key 方式填 **NCBI API Key**；应用标识默认 `LexiVault`；维护者联系邮箱可填 | PubMed 不是全文下载库，PMC 也并非所有文章都可批量取用 |

“访问方式”决定显示哪些输入项以及哪些为必填。界面不把账户密码作为通用字段；用户在来源网站自行申请或创建 Key，然后按所选方式填写。来源页面中的官方链接提供申请入口和规则说明。

OpenAlex 当前官方说明允许基础匿名查询，但游标跨页需要免费 Key；不能将早期“所有请求统一必填 Key”的说明直接套到当前接口。NCBI 的 `email` 用于联系软件开发或部署维护者，不应把第三方终端用户的登录邮箱当作软件维护者邮箱。标准 E-utilities 不超过每秒 3 次请求，携带 Key 默认最多每秒 10 次。Semantic Scholar 的 Key 初始额度通常为每秒 1 次，请以账户获批额度和官方最新文档为准。

## 试用顺序

1. 页面顶部只保留紧凑的标题与搜索工具栏。在左侧资料类型下方点“来源与凭据”，勾选参与检索的平台，再切换来源页签选择访问方式并填写相应字段。点击“应用配置”后勾选和访问方式一起生效；取消会保留原配置。“应用配置”仅检查必填项和邮箱等基本格式，不连接网站、不判断 Key 是否有效。
2. “检索文献”只筛选内置示例。年份、类型、开放获取、排序、摘要展开、来源选择和队列添加／移除都可操作；没有符合条件的示例时显示空状态。筛选分组可以折叠，类型右侧的数字是符合其他条件的本地示例数。年份柱形悬停显示该年数量；拖动时间轴端点时预览范围，松开后筛选，两个端点不会交叉；也可以点击年份只看该年，或展开“输入年份”精确填写。柱形统计遵循其他筛选条件，但不受自身年份范围影响。
3. 只在结果列表内滚动；列表底部固定提供页码与每页 5／10／20／50 篇选择。换页保留已选队列；修改条件或每页条数后回到第一页。启用 OpenAlex 来源并设为每页五篇，可用现有六条示例验证翻页。
4. 点“确认获取到知识库”，此时才打开“选择入库位置”。可选当前工作空间、示例知识库或自定义知识库名称，再选已有示例目录或填写多层目录。
5. 从这个窗口内唯一的“配置下载路径”入口选择实际运行爬取程序的系统，手动填写本地路径，再选择子目录组织与命名方式。支持 `D:\Research\LexiVault`、`/home/you/Research/LexiVault`、`~/Documents/LexiVault` 或 `./downloads`。保存或取消会返回原确认窗口，保留知识库与目录选择。来源信息未补齐时，也可从确认窗口返回凭据配置。
6. “保存获取方案”保存本地草稿，仍不执行下载或入库。队列下方可以导出不含凭据的 JSON，供之后的爬取适配器对接。窄屏通过“检索结果／筛选条件／获取队列”切换区域，仍采用区域内滚动。

下载目录负责未来的原始文件位置，知识库目录负责资料的逻辑归属，两者可以不同。当前手动路径只校验基本格式，不证明目录存在、可写或有足够磁盘空间；真实执行需要之后的本地／服务端程序。知识库列表与目录属于前端选择示例，不会创建 Neo4j、SQLite 或真实知识库目录。

“来源与凭据”中应用的来源选择控制本地结果筛选；停用某个来源不会自动删除已经加入的队列条目。队列始终显示方案将使用的示例来源，确认时校验这些条目对应的配置。

## 保存边界与源码

- 来源选择、访问模式、筛选项、每页条数、队列 ID 和下载设置保存于当前来源的 `localStorage`，键为 `lexivault.discovery.v1`，兼容已有设置。当前页码在刷新或更改条件后回到第一页。
- 最近一份获取草稿保存于 `lexivault.discovery.v1.draft`。刷新后可再次导出。它与研究计划的 IndexedDB 分开，不修改旧工作空间或计划数据。
- API Key、Token 和联系邮箱仅保存在当前页面内存，不写入 localStorage／sessionStorage，不上传、不写日志、不加入草稿或导出文件。关闭配置窗口会清空其 DOM 输入值，下次打开可从当前页内存重新填回；刷新后必须重新填写。
- “清除本页凭据”清除本页所有来源的 Key 和邮箱，保留应用标识的默认值。已经保存的非敏感访问模式可以保留，因此刷新后会提示补齐相应凭据。
- 存储被阻止或配额不足时，页面仍可编辑配置、生成并导出本页方案，并明确反馈没有持久保存。

| 源码 | 职责 |
| --- | --- |
| `src/discover/catalog.js` | 五个来源的官方依据、访问模式、条件字段及明确的本地示例 |
| `src/discover/page.js` | 真实页面和三个配置／确认弹窗 |
| `src/discover/model.js` | 来源规则、示例筛选、路径与目录校验、白名单持久化、无凭据草稿 |
| `src/discover/app.js` | 表单、页签、筛选、队列、路径预览、入库位置选择与导出 |
| `src/discover/year-range.js` | 年份数量浮层、双端滑块、轨道拖动、键盘与精确年份同步 |
| `dist/discover.css` | 与现有设计一致的日夜样式与窄屏布局 |

后续爬取程序应单独接入：先接收不含秘密值的获取计划，再由本地安全配置提供凭据，执行来源适配、按官方限制获取、校验原文与去重，最后将获取结果写入用户选定的知识库。目前没有实现这条执行链，也没有提供爬取代码。

## 官方依据

- [Semantic Scholar API 概览](https://www.semanticscholar.org/product/api)；[官方教程](https://webflow.semanticscholar.org/product/api/tutorial)：匿名访问、个人 Key、速率、`x-api-key` 和开放全文字段。
- [Crossref 访问与认证](https://www.crossref.org/documentation/retrieve-metadata/rest-api/access-and-authentication/)；[Plus 密钥](https://www.crossref.org/documentation/metadata-plus/metadata-plus-keys/)：Public、Polite、Metadata Plus 三种方式，`mailto` 和 Plus Token。
- [arXiv API 手册](https://info.arxiv.org/help/api/user-manual.html)；[使用规则](https://info.arxiv.org/help/api/tou.html)；[批量访问](https://info.arxiv.org/help/bulk_data.html)：公开查询、Atom 元数据、原文链接与访问频率。
- [OpenAlex 认证](https://help.openalex.org/api/authentication/)：基础匿名查询、免费 Key、邮箱激活、游标批量跨页认证及请求认证参数。
- [NCBI E-utilities 使用指南](https://www.ncbi.nlm.nih.gov/sites/books/NBK25497/)：`tool`、维护者 `email`、`api_key` 与标准速率；[PMC 开放获取子集](https://pmc.ncbi.nlm.nih.gov/tools/openftlist/)及[开发者服务](https://pmc.ncbi.nlm.nih.gov/tools/developers/)：可获取全文范围和官方接口。
