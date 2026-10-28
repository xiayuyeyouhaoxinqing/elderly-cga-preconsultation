# 已发布量表列表页测试交接

本次为小组独立功能分支交付，复用GET /api/scales增加keyword，并新增/nurse/scales页面；没有数据库迁移、量表发布或医学评分修改。医护导航新增“已发布量表”。

## 1 Git与代码接收

- 原始压缩包内容作为本地dev基线，功能分支为feat/published-scale-list。没有远程推送，也没有自动合并到dev/main。
- 源码ZIP不含.git、node_modules、.venv、.next和私有配置；需要历史时使用配套bundle。
- 新目录保留历史：`git clone -b feat/published-scale-list 项目历史.bundle 接收目录`。bundle是完整本地快照，不依赖远程。
- 小组已有同模板仓库时，先建自己的测试分支，检查干净工作区，再执行`git apply --check 功能增量.patch`，确认后使用`git apply 功能增量.patch`。不要重复克隆覆盖现有仓库，不强制reset，不盲目cherry-pick压缩包基线。
- 若代码已分化，不强行套补丁；以契约和修改文件清单人工评审。测试结束后由小组决定是否合并；不要覆盖组员未提交改动。

## 2 环境与依赖

从真正代码根目录执行。Python3.11.x、Node22.12至22.x、pnpm10.26.2，保持uv.lock和pnpm-lock.yaml。可用npm exec临时选用指定工具，而不修改全局pnpm：

```powershell
Push-Location frontend
try { npm exec --yes --package=pnpm@10.26.2 -- pnpm install --frozen-lockfile }
finally { Pop-Location }
Push-Location backend
try { uv sync --frozen --extra dev }
finally { Pop-Location }
```

更完整的命令前提、退出码及服务说明见AGENT.md第8节；任何安装命令失败都应停止后续步骤。本次交付未更改依赖清单及锁文件。

## 3 可独立执行的验证

```powershell
# 在backend目录；不需要PostgreSQL、Redis或模型
uv run pytest tests/unit-test/test_scale_list.py tests/integ-test/test_scale_list_sqlite.py -q
```

临时SQLite验证实际ORM查询，但不是PostgreSQL环境验收。路由测试使用显式依赖覆盖隔离身份与DB，证明医护依赖未移除，不把Stub身份当真实登录成功。

```powershell
# 在frontend目录，Node22.12.x及pnpm10.26.2
pnpm check
```

Mock启动：在frontend目录设`$env:NEXT_PUBLIC_DATA_MODE='mock'`后执行`pnpm dev --port 3012`，访问http://localhost:3012/nurse/login，使用界面中的合成演示账号按钮登录，点击“已发布量表”。检查全部、名称“营养”、无匹配、清空、加载及390px横向表格。

API启动：在backend目录执行`uv run uvicorn app.main:app --host 127.0.0.1 --port 8012`。/health正常不代表数据库已就绪。/openapi.json应含keyword参数maxLength50。未登录GET /api/scales应返回401。

真实列表联调必须先配置隔离PostgreSQL/Redis、医护账号与已发布量表，按AGENT配置和获准流程初始化。前端API模式使用NEXT_PUBLIC_DATA_MODE=api、NEXT_PUBLIC_API_BASE_URL=http://localhost:8012；开发跨域测试使用既有允许的localhost:3000（若占用先协商，不停止用户服务）。本次没有初始化或使用用户数据库。

## 4 交付验证状态

实际结果见docs/review/已发布量表列表试创建记录.md。已完成前端检查、5项相关后端检查、API健康/OpenAPI/401以及Mock浏览器行为。没有把Mock说成真实库列表已通过。

当前已知环境阻碍：模板的部分所谓单元测试直接连接127.0.0.1:6379；无Redis时test_event_publisher.py失败，完整后端套件未全绿。该文件及其生产代码与dev基线一致。本功能不需要AI Worker，不应为了列表测试连接真实模型。

关闭本任务自行启动的终端或Ctrl+C即可。不要结束组员前后端、数据库或IDE进程。
