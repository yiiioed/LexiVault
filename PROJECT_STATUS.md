# LexiVault 开发交接

更新日期：2026-10-27。本文记录本轮开发结束时的状态，后续开发应先核对代码。

## 1. 项目与当前任务边界

- 仓库：<https://github.com/yiiioed/research-vault>。
- 当前代码目录：`D:\code\research-vault`。用户数据工作空间：`D:\code\LexiVault工作空间`，与代码目录分开。
- 用户负责后端，目标是科研文献、笔记与知识管理工具，文件组织与本地编辑方式参考 Obsidian。
- **文献阅读先保持现状，用户后续明确要求再改。** 当前没有指定下一项新功能；新对话应根据用户的新需求先给方案。
- 本次交接只新增说明文档，没有更改功能代码。
- 交接时 Git 状态：根 `README.md` 有修改，`backend/`、`frontend/` 尚未被 Git 跟踪。后续请重新确认状态，继续使用同一个本地目录；不要假设 GitHub 已有这些实现。未经用户要求不提交或推送。

## 2. 技术结构

后端使用 Python（已在 3.12 验证）、FastAPI、Uvicorn、SQLite；包含 PDF 检查、文件监听、账号认证等模块。前端为多页 HTML 和 JavaScript ES 模块，使用 esbuild 构建、PDF.js 阅读 PDF、Tiptap 编辑研究计划，Markdown 预览做净化处理。前端构建要求 Node.js 22 或以上。

主要页面：`home.html` 科研智能体、`discover.html` 文献发现、`reader.html` 文献阅读、`plans.html` 研究计划、`graph.html` 主题图谱、`knowledge.html` 知识库管理。存在页面入口不代表其全部业务能力已经接入。

| 范围 | 主要入口 |
| --- | --- |
| 服务启动、静态页面和接口 | `backend/__main__.py`、`backend/app.py` |
| 工作空间、文献索引、笔记 | `backend/storage.py`、`backend/workspace_api.py` |
| 数据库与账号 | `backend/database.py`、`backend/migrations.py`、`backend/accounts.py`、`backend/auth_api.py` |
| 真实文件操作与系统回收站 | `backend/files.py`、`backend/files_api.py`、`backend/recycle.py` |
| 研究计划 | `backend/plans.py`、`backend/plans_api.py`、`frontend/src/plans/` |
| 阅读页 | `frontend/src/reader/app.js`、`page.js`、`tree.js`、`reader.css` |
| 共用文件树与侧栏 | `frontend/src/explorer.js`、`explorer.css`、`sidebar.js`、`workspace-client.js` |
| 文献元数据接口 | `backend/catalog_api.py`，仅持久化，不负责真实检索与下载 |
| 前端构建与资源类型 | `frontend/scripts/build.mjs`、`backend/static.py` |

## 3. 已实现的主要能力

### 工作空间与真实文件

- 全局侧栏工作空间菜单列出已有空间，底部“新建工作空间”，创建后打开，可以随时切换。切换考虑未保存编辑，并清理旧文献查询参数。
- 新空间不带示例论文、计划、对话，也不自动导入旧浏览器内容。
- 用户自由创建文件夹、Markdown，导入 PDF；研究计划和知识库管理提供真实文件树，支持重命名、移动等文件操作。
- 本地文件变化检测与冲突保护已接入；浏览器存储仍可保存界面偏好和应急草稿，但不是文档正文的唯一存储。

### 文献阅读：已确定的交互

- 移除重复的顶部标题与工作空间工具条。左侧是真实文件夹 / PDF 目录，中间原文阅读，右侧笔记。
- 论文标题旁的按钮完全隐藏或展开目录，用户选择的是“按钮隐藏”方案。展开状态持久化；全局主侧栏仍使用原有折叠方式。
- PDF 原文支持翻页、缩放、适合宽度、下载和文本选择。笔记支持 Markdown 编辑 / 预览、页码引用、摘录、自动保存、历史及冲突提示，可以关联已有 Markdown。
- 新建文件夹直接在目录树内输入，不弹创建对话框。放在当前选中文件夹中，未选中文件夹时在根目录创建。
- 默认名称依次为 **未命名、未命名1、未命名2……**。重复名使用紧凑、低饱和度的提示气泡，用户已否定大块橙红提示；重复时按 Enter 使用下一个可用默认名。
- 文件夹 / PDF 行有删除图标，并支持在目录焦点中按 Delete；编辑文字时不能触发文件删除。

### 研究计划与账号

- 研究计划正文保存为本地 Markdown，包含富文本编辑、状态、日期、标签、双向链接、日程 / 关系视图、附件、导入导出和历史等实现；外部修改有版本与冲突保护。
- 已有账号注册 / 登录接口、密码哈希存储和数据库；支持独立启动账号服务。本地文件服务限制监听 `127.0.0.1`。部署整体方案仍需按新需求设计，不能据此宣称已有完整云同步。
- 工作空间对话已持久化。科研智能体是否连接真实模型、主题图谱具体业务完成度，后续须查看对应代码再说明，不能仅凭界面认定完成。

## 4. 文件和数据库保存规则

- 本机登记数据库默认位于 `%LOCALAPPDATA%\LexiVault\app.sqlite`，账号库为同目录 `accounts.sqlite`。
- 每个工作空间内部有 `.lexivault/library.sqlite`，工作空间数据库版本为 **5**。内部目录还存历史、缓存、升级备份等。
- PDF 和 Markdown 正文是用户目录里的普通文件，不要求固定的 `papers/`、`notes/`、`plans/` 文件夹。
- 导入 PDF 保留原始文件名，保存到用户选中的目录；文件散列用于重复识别。
- 阅读笔记首次保存时创建，通常位于论文旁，可在首次保存前指定路径或关联已有笔记。
- Markdown 中的 `lexivault_plan`、`lexivault_document` 元数据用于维持身份和关联，不应随意移除。富文本缓存与正文散列绑定。
- 备份建议关闭服务后备份整个工作空间，不能只复制 SQLite 而漏掉原文与笔记。

删除已改为系统回收站：Windows 使用 `IFileOperation`，其他系统使用 Send2Trash；失败不永久删除。新 UI 调用 `POST /api/workspaces/{w}/files/delete`。旧 `/files/trash` POST 是系统删除的兼容入口，旧回收站查询 / 恢复接口仍为历史数据保留。系统删除路径由 `system_recycled_paths` 记录，以免被当作一般失踪文件；从系统回收站恢复到原位置后可重新识别关联。不要重新增加应用内回收站 UI，也不要自动清空历史 `.lexivault/trash`。

## 5. 最近的 PDF 打不开故障

用户截图报错：`Setting up fake worker failed`，无法动态导入 `/vendor/pdf.worker.min.mjs`。排查发现 Windows 环境下静态服务曾把 `.mjs` 返回为 `text/plain`；在 `nosniff` 下无法作为模块加载。

已完成两层修复：

1. `backend/static.py` 的 `FrontendStaticFiles` 明确为 `.js` / `.mjs` 返回 JavaScript MIME，并覆盖相关缓存响应；静态缓存策略也包含 `.mjs`。
2. 构建时生成带内容散列的 `pdf.worker.<hash>.js`，通过 `__PDFJS_WORKER_URL__` 注入阅读页，避免继续使用旧资源地址。Worker 与安装的 PDF.js 保持一致；旧 `.mjs` 资源暂保留兼容旧标签页。

同时修复“加载失败后再次点击同篇论文被提前返回”的问题，现在允许重试且保护笔记草稿。

验证情况：在用户正在运行的 **8000 服务和真实工作空间**中，通过 Codex 内置浏览器打开用户导入的 `D-Pingmesh_arXiv2610.29787.pdf`，显示 **15 页**，验证翻到第 2 页、返回第 1 页，原笔记保留。**用户自己的 Edge 标签页尚未反馈最终结果**，不要把内置浏览器验证写成用户已确认。如果再报错，先核对正在运行的服务目录、实际加载脚本、Worker 地址、响应类型与控制台错误，不要直接归因于 PDF 损坏或让用户反复导入。

## 6. 启动与开发检查

在项目根目录启动现有环境：

```powershell
backend\.venv\Scripts\python -m backend
```

打开 <http://127.0.0.1:8000/reader.html>。也可加 `--port 8001` 或 `--workspace "D:\ResearchLibraries\我的课题"`。不要启动第二个服务占用用户已有的 8000 端口。

首次准备环境：

```powershell
python -m venv backend/.venv
backend\.venv\Scripts\python -m pip install -r backend/requirements-lock.txt
cd frontend
npm ci
npm run build
```

修改前端后，在 `frontend/` 运行 `npm run build`；需要时浏览器强制刷新。修改 Python 后重启后端。`npm start` 仅用于静态预览，不能替代完整服务。

检查命令按修改范围选用：

```powershell
# 项目根目录，后端测试需要 requirements-dev.txt 中的依赖
backend\.venv\Scripts\python -m pytest backend/tests
backend\.venv\Scripts\python -X utf8 frontend/qa/check_static.py

# frontend 目录
npm test
node --test qa/reader.test.mjs qa/reader-assets.test.mjs
```

历史验证记录（不是本次文档变更重新执行的结果）：

- 系统回收站改动后的后端全量：69 通过、1 跳过；之后新增静态资源测试，静态资源与阅读相关定向测试 14 通过，未再跑全量后端。
- PDF 最新修复前前端全量：143 通过；最新修复后阅读与资源定向测试 23 通过，未再跑全量前端。
- 最新前端构建及静态页面 / 资源检查通过。
- Windows 原生回收站集成验证通过，确认测试文件进入系统回收站且内容保留。该脚本为手动验证，不要反复运行真实删除测试。

测试目录和本地 QA 数据位于 `backend/tests/`、`frontend/qa/`、`backend/local-data/`；QA 样例不是用户资料。

## 7. 待办与后续接手方式

- **文献发现尚未接入真实检索与下载**，当前默认空结果；已有界面、目录选择和部分元数据持久化，不能称作完整爬取链路。
- 云部署、跨设备同步、实际模型连接和图谱能力须按用户选择另行核对、规划；不要自动开展这些工作。
- 原始项目方案曾来自微信文件目录，未因本次交接自动复制进仓库。如新任务依赖其中细节且仓库没有对应内容，需要再向用户获取文件或路径，不能编造原始要求。
- 新对话在此项目的同一个本地目录打开，先读本文件、`AGENTS.md`、`README.md`；通常无需重复上传已有代码与文档。

可复制给新对话的开场：

> 请先阅读 AGENTS.md、PROJECT_STATUS.md 和 README.md，检查实际代码。文献阅读保持现状，本次开发【新功能名称】。先给我方案，等我同意后再修改。

补充说明：[后端说明](backend/README.md)、[数据库说明](backend/DATABASE.md)、[工作空间说明](backend/WORKSPACE.md)、[研究计划说明](backend/PLANS.md)、[前端说明](frontend/README.md)。
