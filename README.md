# research-vault
面向科研学习的本地文献、笔记与 AI 知识库

现阶段已实现文献阅读第一版：工作空间文献列表、真实 PDF 阅读、Markdown 笔记本地保存、外部文件变化检测与冲突副本。文献发现尚未接入真实检索和下载，默认显示空白结果。

现已接入本地账号注册／登录和数据库第五版：账号、本机工作空间登记、每个工作空间的文献数据分别存储。PDF 和 Markdown 正文仍保存在本地文件夹。位置、备份与迁移说明见 [数据库说明](backend/DATABASE.md)。重启 Python 服务后生效。

工作空间现已统一：在文献阅读页打开一个本地目录，首页与各页侧栏都使用该空间。对话保存在空间的 `.lexivault/library.sqlite` 中；新空间不生成示例论文、示例对话或示例计划。研究计划与阅读笔记都是普通 Markdown，可以放在任意自己创建的文件夹中；知识库管理和研究计划页提供真实文件树。新空间不自动导入旧浏览器内容。详见 [工作空间说明](backend/WORKSPACE.md)。

## 启动文献阅读

在项目根目录运行（当前已安装本机依赖）：

```powershell
backend\.venv\Scripts\python -m backend
```

打开 <http://127.0.0.1:8000/reader.html>。关闭服务窗口即可停止。

首次在另一台机器准备环境（已在 Python 3.12 验证）：

```powershell
python -m venv backend/.venv
backend\.venv\Scripts\python -m pip install -r backend/requirements-lock.txt
backend\.venv\Scripts\python -m backend
```

若 8000 端口已被前端预览占用，请停止原预览或加 `--port 8001`。阅读功能需由 Python 服务同时提供页面和接口；只运行前端 `npm start` 不会提供本地笔记接口。

## 第一次使用

1. 在全局侧栏的工作空间菜单中创建或切换空间。若要打开磁盘上已有目录，点击阅读页左栏的“导入 PDF”图标，在弹窗中选择“打开本地工作空间”。
2. 侧栏“新建工作空间”默认存放在 Windows 的 `%LOCALAPPDATA%\LexiVault\workspaces\` 下，创建后自动打开。
3. 在左侧展开实际文件夹，点击 PDF，在中间阅读、右侧记录笔记。左栏右上角可导入 PDF；窄屏使用“论文目录／论文原文／阅读笔记”切换。
4. 右侧显示“已保存到本地”后，可在其他编辑器中打开对应 Markdown 文件。外部修改会自动更新；存在未保存草稿时会提示冲突。

新工作空间只生成 `.lexivault/` 内部目录，用于数据库、缓存和历史。文件删除使用电脑系统回收站，恢复到原位置后自动识别；应用内不再设置回收站入口。通过研究计划页或知识库管理页新建文件夹和笔记，导入 PDF 时选择目录；阅读笔记在首次保存时创建，也可关联已有 Markdown。工作空间不应放在代码仓库中。

可直接指定目录：

```powershell
backend\.venv\Scripts\python -m backend --workspace "D:\ResearchLibraries\我的课题"
```

详细的保存规则、接口、测试和限制见 [backend/README.md](backend/README.md)。前端源码与构建说明见 [frontend/README.md](frontend/README.md)。
