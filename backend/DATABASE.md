# 数据库存储说明

数据库负责身份、关系和结构化信息；论文 PDF 与笔记 Markdown 仍是普通本地文件。笔记正文只写入 Markdown 文件，数据库不重复保存正文。

| 文件 | 保存内容 |
| --- | --- |
| `%LOCALAPPDATA%\LexiVault\accounts.sqlite` | 邮箱、昵称、Argon2id 密码哈希、会话摘要、用户设置、登录限流记录；验证／重置令牌表预留 |
| `%LOCALAPPDATA%\LexiVault\app.sqlite` | 本机工作空间登记路径、最近打开时间和最近使用账号 |
| 每个工作空间下的 `.lexivault/library.sqlite` | 文献元数据、附件与版本、笔记路径与哈希、来源、标签、收藏夹、阅读进度、批注、引用关系和任务状态 |

`--data-dir` 可更改前两个数据库所在目录。工作空间可以放在其他磁盘，数据库使用相对于空间根目录的文件路径。

工作空间 v3 新增 `conversations`、`messages` 和 `assistant_state`，保存该空间的对话、消息和首页状态。v2 升级前同样生成备份，论文和笔记文件不受影响。当前空间由本机登记库中的最近打开记录确定，不再从旧浏览器示例名称推断。

工作空间 v4 新增 `plans`、`plan_files`、`plan_preferences`。计划正文以磁盘 Markdown 为准，数据库仅保存元数据、路径、哈希与版本；富文本编辑缓存位于工作空间 `.lexivault/plan-docs`，不作为外部正文的替代来源。旧库升级前自动备份。

工作空间 v5 将数据库统一放入 `.lexivault/library.sqlite`，新增 `workspace_settings` 和 `file_trash`。旧根目录数据库会复制到内部目录后迁移，正文不搬动；新空间不预设文档目录，也不自动导入浏览器旧计划。回收站、历史、编辑缓存和升级备份均保存在 `.lexivault` 中。

工作空间表：`documents`、`attachments`、`revisions`、`notes`、`reading_progress`、`source_records`、`annotations`、`note_citations`、`tags`、`document_tags`、`collections`、`collection_items`、`jobs`，另有版本管理表。

文献可先只有标题、作者、年份、摘要和 DOI，后续导入 PDF 时传入文献 ID 补充全文。未获取到全文时，阅读页保留笔记入口并提示补充 PDF。任务表目前只提供持久化和状态流转，尚未实现下载、解析或索引执行器。标签、收藏夹等已有后端接口，完整管理界面待后续接入。

## 账号与部署边界

登录注册页已调用真实本地账号接口。密码使用独立随机盐进行 Argon2id 哈希；会话 Cookie 为 HttpOnly，数据库只存令牌摘要。退出撤销当前会话。设置保存主题和笔记字号。账号数据库不保存论文或笔记。

默认仍允许访客阅读本机文件。登录不构成电脑上不同操作系统用户之间的文件隔离，切换账号也不会隐藏已登记的本机工作空间。

可用 `python -m backend --account-service --host 127.0.0.1 --port 8002` 单独启动账号接口；该模式不暴露工作空间和文件接口，默认 Cookie 需要 HTTPS。远程客户端配置、生产部署、邮件验证和密码找回邮件尚未完成。当前账号仅存在启动服务的电脑，尚未实现跨设备通用或文件同步。

## 升级和备份

首次启动自动创建账号和登记数据库，将旧 `workspaces.json` 导入登记表并保留原 JSON。旧工作空间数据库从 v1 升级到 v2；迁移前生成工作空间 `.lexivault/backups/library-v1-时间.sqlite`，迁移在事务内执行。保留原文献 ID、文件路径、页码和旧引用版本标识，不重写原件或 Markdown 正文。新数据库不需要旧版备份。

也可关闭旧服务后在项目根目录执行：

```powershell
backend\.venv\Scripts\python -X utf8 -m backend.manage status
backend\.venv\Scripts\python -X utf8 -m backend.manage upgrade
```

备份整个资料库时应关闭服务并复制整个工作空间；只备份数据库不包含论文和笔记。账号和本机登记数据库需要另行备份。数据库回退前先停止服务并保留当前文件副本，同时使用与旧结构兼容的程序版本。

## 使用 Navicat 查看

创建 SQLite 连接，选择上述 `.sqlite` 文件即可，无需安装 MySQL。建议只查看数据，通过应用接口修改，以保持版本、关联和本地文件一致。密码字段只能看到哈希，不能还原原始密码。

文献发现后续应先登记来源和元数据，再通过导入接口补充 PDF；下载失败可以保留元数据和笔记。
