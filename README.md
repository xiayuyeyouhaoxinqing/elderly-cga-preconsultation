# 老年预问诊与综合评估系统

本项目面向门诊老年患者和医院职工。患者在就诊前填写评估信息，职工在工作台查看任务和量表，为接诊时的核验和综合评估做准备。

## 当前版本

`main` 提供患者和职工双入口、职工登录与已发布量表查询，以及 B.1、B.2 各一道代表题的报告草稿演示。界面以医院蓝为主色，已在手机、平板、电脑和自助机模拟视口验证。门诊登记和患者会话的开发进展见 [第二周功能分支](https://github.com/xiayuyeyouhaoxinqing/elderly-cga-preconsultation/tree/feat/week2-outpatient-portal)。

项目目标是接入全部 21 项工具，支持数据采集、人工核验、计分及综合报告。适用性、正式计分和报告审核按临床规则与权限执行。 [项目总需求](./项目构想总需求.md)

## 本地体验

使用 Node.js 22.12 或更高的 22.x 版本和 pnpm 10.26.2。在仓库根目录打开 PowerShell：

```powershell
Set-Location frontend
pnpm install --frozen-lockfile
if ($LASTEXITCODE -ne 0) { throw '安装前端依赖失败' }
$env:NEXT_PUBLIC_DATA_MODE = 'mock'
pnpm dev
```

打开终端显示的本机地址。首页可进入患者端、职工端或「体验评估样板」。职工端可用演示账号查看已发布量表。Mock 模式使用合成数据，可独立运行。

## 开发与验证

| 路径 | 内容 |
| --- | --- |
| `frontend/` | Next.js、React 和 TypeScript 页面，包含患者端、职工端和数据访问层 |
| `backend/` | FastAPI 服务、SQLAlchemy 模型、Alembic 迁移和测试 |
| `docs/` | 开发计划、接口和数据库设计 |
| `deploy/` | 安装与部署说明 |

前端在 `frontend/` 执行 `pnpm check`，运行测试、Lint、类型检查和构建。后端使用 Python 3.11 和 uv。真实服务模式需要 PostgreSQL 16、Redis 7 及隔离测试数据，启动和迁移步骤见 [工程指南](./AGENT.md)。职工登录和量表查询的复测方法见 [量表列表测试交接](./TESTING_SCALE_LIST.md)。

## 协作流程

从 `dev` 新建 `feat/...` 或 `fix/...` 分支。完成验证后，提交 Pull Request 合回 `dev`，并在描述中写明测试命令和结果。通过验收的版本从 `dev` 提交 Pull Request，由仓库所有者审核并合入受保护的 `main`。
