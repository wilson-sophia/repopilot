# RepoPilot 前端工作台

`app/research/page.tsx` 是入口；组件沿用 Vercel Chatbot 已有的 React、TypeScript、Radix Dialog 和 Streamdown 依赖。界面未预填虚构项目、报告或指标。首次进入需要创建真实项目。

## 文件与职责

- `index.tsx`：三栏工作台、项目导航、问题输入、主题与资料入口。
- `use-research-workspace.ts`：HTTP 数据、项目切换、上传、取消和流式运行状态。
- `api.ts`：统一错误处理与 SSE 分帧解码。
- `views.tsx`：工具时间线、报告、资料列表、引用预览和项目表单。
- `index.css`：隔离在 `.research-workspace` / `.research-dialog` 下的语义主题变量与响应式布局。

## 一次提问的数据链路

1. 提交 `POST /api/research/projects/:id/runs`，请求体包含 `prompt`。
2. `run` 事件建立运行记录；`tool`、`source` 事件按 ID 更新对应集合。
3. 文本增量在 40ms 窗口聚合后更新当前报告，避免逐 token 更新整份 Markdown。
4. `done` / `error` 事件用服务端保存的记录替换本地增量状态。
5. 刷新页面后从项目详情读取历史；若记录仍运行，仅轮询真实状态，不生成虚假的“已完成”。

SSE 使用流式 `TextDecoder`，只有完整帧才执行 JSON 解码，支持 UTF-8 汉字跨网络分包及 CRLF。报告组件通过 `memo` 保留未变化的历史报告。

## 状态与可访问性

- 组件回调统一使用 `on*`，受控对话框使用 `open` / `onOpenChange`，列表属性使用 `dataSource`。
- 工具执行和运行状态直接来自服务端；演示模式在页顶和报告旁明确标识。
- 所有可操作元素为原生按钮、表单或链接；Dialog 使用现有 Radix 封装处理焦点与 Escape。
- 问题输入支持 Enter 提交、Shift+Enter 换行，中文输入法组合期间不会误提交。
- 资料上传、错误和运行完成通过适量 `role=status` / `role=alert` 反馈；不逐 token 播报全文。
- 外部引用按钮限制为 HTTP/HTTPS 链接；文档内容作为文本预览，不注入 HTML。

## 稳定的验收定位

标签：`新建项目`、`项目名称`、`GitHub 仓库`、`项目描述`、`创建项目`、`上传文档`、`研究问题`、`开始调研`、`停止`、`导出报告`。

测试标识：`research-workspace`、`project-card`、`document-card`、`research-run`、`run-report`、`tool-card`、`source-button`、`source-drawer`。

## 复盘时重点阅读

先跟踪一次文档上传，再跟踪一次提问的 `ResearchEvent`。区分业务状态、网络连接状态和展示状态：断线不等于任务成功；取消也应先保存服务端终态。前端负责展示与操作，不承担授权判断或生成引用的可信性判断。
