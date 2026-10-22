# Changelog

本文件记录 RepoPilot 相对 Vercel Chatbot 基线的变化。实际测试范围与证据见 `docs/VERIFICATION.md`。

## Unreleased

### 调研应用

- 新增开源项目调研领域类型与 `/research` 工作台。
- 围绕项目资料、文档检索、仓库信息和 Issue 搜索建立调研流程。
- 展示结构化工具执行过程、来源证据、报告与历史。

### 本地运行与质量

- 提供本地 PGlite / pgvector 与外接 PostgreSQL 的运行路径。
- 用独占启动器和 PostgreSQL socket 管理本地数据库，支持 Next.js 多进程访问、目录独占和退出清理。
- 明确区分演示执行、真实模型与测试夹具。
- 增加开发记录、架构说明、技术决策、接口说明、面试复盘和示例资料。
- 自动化验证结果及限制持续记录在 `docs/VERIFICATION.md`。

### 修复与验证

- 修复生产 HTTP 下的会话 cookie 读取策略，按部署 / 请求 URL 协议选择，避免访客跳转循环。
- 区分构建期数据库隔离与运行期磁盘初始化，修复新生产数据库缺表问题。
- 等待 socket 的延后关闭回调并规范主动停止的退出码，避免数据库清理竞态。
- 排除本地数据、测试输出和环境文件的构建追踪；全量扫描敏感引用为 0。
- 本地通过 28 个单元测试、23 个 Playwright 入口（包含 20 个固定案例）、重启持久性、生产构建与生产 HTTP 冒烟。
- 真实 GitHub 手动流程通过；真实聊天 / Embedding、TLS 与外接 PostgreSQL 仍未独立验证，远程 CI 待推送后确认。

### 上游来源

- 基于 `vercel/chatbot@c2f8235e1f3ea903ad8b7f61447c4f74164b5c58`。
- 保留 Apache-2.0 许可证及原始 README。
