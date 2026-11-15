# 验证记录

## 跨轮调研验证：2026-11-15

- 同项目后续问题持久化父运行关系，继承最近3轮问答、来源和已完成只读工具结果，源码保持相同提交。提供重新查证开关，资料范围变化和证据过期时不复用。
- 45项单元／契约测试、27项API／浏览器测试、TypeScript、变更文件Biome、生产构建与生产HTTP烟测通过。
- 真实模型浏览器实验：第一轮 `d9d45841-dce6-43ea-a5ac-34f14555884d` 执行2次新查询；第二轮 `f426be76-c0bd-43eb-8458-a37ee44583a1` 父记录指向第一轮，0次新查询、2条复用工具记录；第三轮 `79eee50b-3e0d-49fd-b822-25bcc633fd5e` 勾选重新查证后无历史记忆，执行4次新查询。刷新后仍可读取历史记录。
- 设计、缓存边界与失效方式见 [跨轮调研说明](CROSS_ROUND_MEMORY.md)。没有假定当前工具可以读取Codex其他侧边聊天；需求按本聊天中的跨轮延续要求实现。

## 检查点恢复验证：2026-11-15

运行恢复改为保留模型步骤消息、已完成工具结果、来源和源码快照，不再清空重跑。45项单元／契约测试与26项API／浏览器测试通过。新增进程强杀用例验证重启后的请求包含已完成工具消息，工具记录和来源ID不变。

真实浏览器和真实模型实验通过：任务 `d6bdd058-fcc4-4362-b6e8-9b96714cad5c` 在第1个模型步骤提交后强杀服务，重启后同一任务继续至第4步完成；原完成工具ID `fce818e8-02ad-4856-bff4-41eb40fb8d26` 保留，来源从4个增至5个，刷新后报告可查看。实验使用隔离数据目录，没有改动用户原有项目。恢复边界见 [CHECKPOINT_RECOVERY.md](CHECKPOINT_RECOVERY.md)。

## 源码调研完整验证：2026-11-14

- 新增固定提交目录分析和源码按行补读工具，源码引用包含路径、行号、提交SHA及固定链接；现有文档检索、来源预览、导出和历史读取保持兼容。
- 单元与契约测试44 / 44通过。新增源码路径限制、符号链接排除、固定提交读取、行号、目录截断标识、大小限制、取消及覆盖范围测试。
- API及浏览器回归26 / 26通过。仓库fixture用例验证源码片段、行号链接与commit字段进入报告来源并可从历史读取；其他流程包含导入、检索、引用、导出、刷新、取消重试及移动端布局。
- 真实服务完整烟测通过，明确禁用fixtures：使用真实模型、Embedding和GitHub读取 `wilson-sophia/repopilot`，生成入库关键词与假设性问题，调用源码分析及 `readRepositoryFile` 补读，取得5个源码来源，最终报告包含需求文档验收标识及来源引用。测试数据库在结束后清理。
- 真实流程发现模型可能用完6步而没有正文，已保留最后一步强制生成报告，停止继续工具调用；模拟模型连续5次工具调用、最后一步报告的回归用例通过，真实流程重跑通过。
- TypeScript、变更文件Biome、生产构建及生产HTTP烟测通过。源码覆盖为有限目录及文件片段，不等同于全仓库审计或运行验证。设计见 [CODE_ANALYSIS.md](CODE_ANALYSIS.md)。

## 检索增强验证：2026-11-14

- 入库新增模型关键词与假设性问题生成、独立检索文本及元数据；查询新增项目内关键词召回与向量召回的 RRF 融合，引用保留原文。
- 单元与契约测试：41 / 41 通过，覆盖生成失败降级、取消传播、RRF合并去重、关键词独立命中、项目与用户隔离、向量空间隔离，以及模型工具结果和引用持久化。真实模式模拟契约还验证Embedding输入包含生成的问题。
- Playwright API与浏览器测试：26 / 26 通过，包含固定案例评测、文本导入、检索报告、来源查看、导出、刷新、取消重试和移动端布局。
- 真实供应商服务层完整流程：通过。`scripts/check-hybrid-live.ts` 使用临时数据库和当前本地供应商配置，生成8个关键词与3个假设性问题，验证真实Embedding、生成问题检索命中、文档工具调用和包含验收标识及引用的报告持久化。此为单份短中文需求文档的烟测，不代表通用检索质量已提升；当前供应商流式返回的Token用量为0，不能据此推算真实费用。
- TypeScript检查、变更文件Biome检查及生产构建：通过。
- 生产HTTP烟测：通过；24个NFT清单、7177条引用未包含项目私有路径，访客经过2次跳转建立会话，项目接口与正常退出通过。Windows测试退出改用父子进程IPC通知，避免SIGTERM强制杀死启动器而跳过清理。
- 设计与兼容策略见 [RETRIEVAL.md](RETRIEVAL.md)。旧文档可以继续读取，需重新导入才会生成增强元数据与新向量。

以下为较早版本验证记录，范围和数量仅对相应版本有效。

本文件只收录实际执行结果。自动化夹具、演示执行与真实外部服务验证分别记录。

## 验证范围

- 类型检查与生产构建：检查工程是否可编译。
- 领域 / API 测试：检查输入校验、资料检索、用户隔离、运行持久化和异常处理。
- 浏览器测试：检查用户从创建项目到报告、引用和历史的完整流程。
- 固定案例评测：检查固定问题集合下的预期行为，保留失败分类。
- 外部服务：GitHub 与真实模型供应商应分别记录，不因夹具测试通过而推定外部联调完成。

## 当前状态

截至 2026-10-22，已完成本地初始化、类型检查、代码规范检查、28 个单元测试和 23 个 Playwright 测试入口的回归。Playwright 中包含的 20 个固定工程 / 检索案例全部通过。完整进程重启后的持久性、本地数据库独占锁、最终生产构建、生产 HTTP 冒烟、全量 NFT 文件追踪扫描，以及真实 GitHub API 的手动完整流程均已通过。私有 `main` 已推送，正式推送触发的远程 CI 全部步骤成功；真实模型供应商联调仍未执行。

## 已确认结果

| 检查 | 实际结果 | 范围 |
| --- | --- | --- |
| `pnpm run setup:local` | 通过 | 本地 PGlite / pgvector 初始化 |
| `pnpm typecheck` | 通过 | 当前工程 TypeScript |
| 定向 Biome 检查 | 通过 | 后端相关 15 个文件与 UI 相关 6 个文件 |
| `pnpm test:unit` | 28 / 28 通过；最新重跑约 1.71 秒 | 基础逻辑 4、模拟 Embedding 契约 4、模拟 GitHub 边界 7、SSE 解析 5、模拟真实模式 Agent 1、HTTP / HTTPS cookie 策略 7 |
| `pnpm exec playwright test -c playwright.research.config.ts` | 23 / 23 通过；27.4 秒 | 16 个 API 场景、1 个固定案例评测入口、6 个浏览器流程 |
| 固定工程 / 检索评测 | 20 / 20 通过；其中 12 个检索案例通过 | 演示模式、本地特征哈希向量、固定 GitHub 数据 |
| `node --import tsx scripts/check-research-persistence.ts` | 通过 | 完整服务重启后的身份、项目、文档索引与报告保留；同目录第二个持有者被拒绝 |
| `pnpm build` | 通过 | Turbopack 与 TypeScript 编译、生成 19 条路由产物；不等于逐一验证全部上游业务接口 |
| 全量 NFT 构建追踪扫描 | 24 个清单、7189 条引用、1011 个唯一文件；敏感引用为 0 | 无本地数据目录、测试结果目录或环境文件引用 |
| `pnpm test:production` | 通过 | 生产 HTTP 访客会话、有限跳转、项目创建 / 列表 / 删除、正常退出与全量 NFT 扫描 |
| 浏览器手动真实 GitHub 流程 | 通过 | `vercel/chatbot` 元数据、5 条 Issue、6 个来源，完成报告与状态展示 |

单元测试包含受控模拟 HTTP 响应，不需要真实供应商密钥。它验证参数、响应处理、重试、取消及数据边界，不验证真实模型回答质量。

7 个新增 cookie 测试验证按 `AUTH_URL` / `NEXTAUTH_URL` / 请求 URL 协议选择 Secure cookie 的策略；这属于策略单元测试，不是实际 HTTPS / TLS 部署验证。

新增的真实模式 Agent 契约测试使用模拟 HTTP 服务，实际走两步聊天、文档工具执行、引用回传、完成持久化与正数用量记录。它覆盖真实模式代码路径，但不代表真实供应商服务已完成联调。

本轮固定案例的平均运行耗时约 150 毫秒，仅代表当前机器、演示模式和固定工具数据下的工程执行时间，不能作为真实 LLM 延迟、推理质量或生产成功率指标。完整评测快照见 [evidence/research-evaluation-2026-10-22.json](evidence/research-evaluation-2026-10-22.json)。

干净回归日志未出现先前的 WASM `Aborted` 或 `UnhandledRejection`；仍有终端颜色环境提示，不影响测试结果。

重启烟测验证的是：停止应用与本地数据库父进程后，重新启动服务，原签名访客身份仍有效，项目、原文及向量检索、报告导出仍可读取；同时第二个启动器不能接管正在使用的同一数据库目录，也未破坏第一个实例。实际结果快照见 [evidence/research-persistence-2026-10-22.json](evidence/research-persistence-2026-10-22.json)。这证明已完成数据持久化与启动器独占管理，不表示进行中的 Agent 任务具备跨重启续跑能力。

补充退出顺序修复后，重启持久性最新重跑通过，日志未出现 `TypeError`、`UnhandledRejection` 或 WASM `Aborted`。本地主动停止进程时，由启动器发送的 SIGTERM 归一为正常退出；socket 的延后关闭回调处理完后再关闭数据库。

生产构建仅出现 `metadataBase` 未配置时回退 localhost 的提示，没有构建错误。公开域名部署时应配置合适的元数据基址；本次没有公开发布网站。

曾发现输出文件追踪把 `.data` 与 `test-results` 包含进构建依赖，已通过 Turbopack 忽略配置与 `outputFileTracingExcludes` 修复。最终构建未再出现对应 NFT 追踪提示；生产冒烟完成全量扫描，共 24 个 NFT 清单、7189 条引用及 1011 个唯一文件，敏感目录 / 环境文件引用为 0。实际快照见 [evidence/research-build-artifacts-2026-10-22.json](evidence/research-build-artifacts-2026-10-22.json)。

生产 HTTP 冒烟从全新隔离数据库启动构建后的应用，访客经过 2 次跳转建立会话；cookie 为 `authjs.session-token`，具有 HttpOnly，HTTP 下不设置 Secure。再次访问工作台不再跳转，项目创建 / 列表 / 删除成功，启动器以退出码 0 正常关闭，日志未出现 `TypeError`、未处理拒绝或 WASM `Aborted`。实际快照见 [evidence/research-production-2026-10-22.json](evidence/research-production-2026-10-22.json)。该结果不表示完成真实 TLS 部署验证。

真实 GitHub 验证未启用固定数据夹具，通过浏览器操作查询 `vercel/chatbot`，实际取得仓库信息与 Issue，报告完成并显示来源。此次使用的是明确标注的本地演示报告组织，不能据此声称调用了真实大模型。单次工具耗时不作为通用性能结论。

## 远程交付：2026-10-22

- 私有仓库：[wilson-sophia/repopilot](https://github.com/wilson-sophia/repopilot)，`main` 已完成推送。
- 远程验证提交：`fe4c6951ba9b859ab549b61b1b2cc35c5b08d4e0`。
- 正式推送 CI：[Actions run 39776035384](https://github.com/wilson-sophia/repopilot/actions/runs/39776035384)，状态 `completed`，结论 `success`。
- CI 元数据与步骤结果快照：[evidence/github-ci-2026-10-22.json](evidence/github-ci-2026-10-22.json)。
- 远程步骤全部通过：依赖、代码规范、类型、28 个单元测试、API 与 20 个固定案例、6 个浏览器流程、重启持久性、生产构建、生产 HTTP 冒烟及验证产物保存。
- 随后追加的交付说明为纯文档更新，以 `[skip ci]` 标记，不修改应用源码、依赖锁定、测试或工作流。因此后续文档提交与上述已验证提交具有相同的已验证源码，不能将文档提交误认为又执行了一轮 CI。

## 尚未验证的外部范围

- 未提供真实聊天模型 / Embedding 密钥，因此仅完成受控 HTTP 契约测试，没有真实模型供应商质量或稳定性结果。
- 没有对独立外部 PostgreSQL 实例开展集成验证；本地 PGlite + PostgreSQL socket 路径已验证。
- 保留的原始 Chatbot 路由可能依赖其 AI Gateway、Blob、Redis 等服务，本轮验证聚焦新增研究工作台。

## 中间集成记录

第一轮接口与资料评测中，14 个 API 场景和 20 个固定案例通过；浏览器流程因来源检查失败。来源判断已从内部归一化 URL 调整为请求 Host / 可配置 `APP_ORIGIN`，随后重新启动完整回归。因此这一记录只说明调试过程，不计为最终全流程通过。

## 结果记录格式

每次运行记录实际命令、环境、退出结果、产物路径及重要限制。测试凭据与用户密钥不写入本文件。

## 自动化入口

- `pnpm test:unit`：28 个核心逻辑、模拟外部接口 / Agent 契约、cookie 策略与 SSE 解析测试。
- `pnpm test:research`：API、资料检索与固定案例；使用隔离目录 `.data/test-e2e`，启动独立的本地服务。
- `pnpm test:e2e:research`：浏览器流程；同样由 Playwright 配置启动独立服务，不复用开发中的服务。
- `pnpm test:persistence`：使用独立数据目录完整停止并重启服务，验证身份、数据、索引与报告保留，以及本地目录独占。
- `pnpm test:production`：在 `pnpm build` 后执行，验证生产 HTTP 会话、项目接口、退出清理及全量 NFT 文件追踪。
- `pnpm exec playwright test -c playwright.research.config.ts`：一次运行 API / 固定案例与浏览器两组测试，不包含单元与重启持久性脚本。
- `pnpm eval:research`：单独运行 20 个工程 / 检索案例；需要先在另一终端启动测试模式服务，默认地址 `http://127.0.0.1:3100`，可用 `RESEARCH_BASE_URL` 修改。

单独评测的服务启动示例（先停止当前 Next.js 开发服务，避免共用默认构建目录的锁冲突）：

```bash
RESEARCH_MODE=demo RESEARCH_FIXTURES=1 PGLITE_DATA_DIR=.data/evaluation pnpm dev --hostname 127.0.0.1 --port 3100
```

随后在另一个终端执行 `pnpm eval:research`。固定案例评测会保存 `test-results/research-evaluation.json`。这是固定工具数据下的工程与检索评估，不是真实模型推理能力评估。

Playwright 配置输出 `test-results/research-results.json` 与 `playwright-report/research/`。CI 使用 `.github/workflows/research-ci.yml`，按依赖安装、数据库准备、代码规范、类型检查、单元测试、API 测试、浏览器测试、重启持久性、生产构建和生产 HTTP 冒烟的顺序执行。`pnpm typecheck` 内含 Next.js 类型生成，保证新克隆的 CI 不依赖本地开发产生的 `next-env.d.ts` / 路由类型。保留的上游工作流已调整为手动触发。正式推送的远程结果已单独确认，见上方 Actions 链接与测试提交记录。

## 2026-11-13 增量验证

本轮新增项目编辑 PATCH 接口与工作台表单；资料导入增加 PDF 文本层与 DOCX 原文提取；启动器自动恢复数据库中仍为 running 的任务，沿用原任务 ID，清空部分生成内容后重新执行。取消状态通过数据库检查同步到恢复进程。

- TypeScript 检查通过。
- 原有及文档解析单元测试 34/34 通过；新增独立进程恢复测试 1/1 通过（关闭数据库、启动恢复进程、重新打开并核对同一任务完成）。
- API 回归 17/17 通过，包含项目编辑持久化、非法仓库地址拒绝。
- 第一轮完整 Playwright 入口：17 个 API / 固定评测入口通过，6 个浏览器用例因本机缺少 Chromium 无法启动，不能记为浏览器通过。

边界：PDF 不含 OCR；仍保留 1 MiB 文件上限、256 片段上限，并限制提取文本不超过 50 万字符。重启恢复是重新执行调研，不是精确续接模型 token；可能重复产生供应商调用费用。当前启动器恢复适用于单实例，不提供分布式任务租约。未接入真实模型供应商。

### 本轮最终补充结果

- 最新完整单元测试：35/35 通过，包含新进程任务恢复。
- 生产构建 `pnpm build` 通过；仍有既有 metadataBase localhost 提示。
- 使用本机 Edge（PowerShell 设置 `$env:RESEARCH_BROWSER_CHANNEL="msedge"`）运行 6 个浏览器流程，6/6 通过。默认仍使用 Playwright Chromium；此前缺少 Chromium 的失败为环境缺失，已通过 Edge 完成浏览器回归。
- 本轮未重跑生产 HTTP 冒烟；未完成真实模型质量验证、真实 TLS 或分布式部署验证。
