# 接入阿里云百炼

本项目建议先使用 `qwen-plus` 作为支持工具调用的对话模型，使用 `text-embedding-v4` 生成文档向量。两者使用同一地域、同一业务空间的普通百炼 API Key；项目通过兼容接口调用，无需另外安装模型 SDK。

以下设置按 2026-10-22 查阅的官方文档整理。配置模板不代表已完成真实供应商联调；真实联调需要本地密钥。

## 申请 API Key

1. 注册并登录 [阿里云百炼控制台](https://bailian.console.aliyun.com/)，按提示开通服务、完成所需的实名认证。
2. 选择 **华北2（北京）** 地域，并在业务空间管理中查看默认业务空间的 **WorkspaceId**。
3. 打开控制台的 **API Key / 密钥管理**，创建普通按量调用的 API Key，归属账号与业务空间选择自己的账号、默认业务空间。若设置模型访问范围，需同时允许 `qwen-plus` 和 `text-embedding-v4`。
4. 复制密钥，保存在项目本地 `.env.local`。API 调用按平台计费规则结算，免费额度与可用模型以当前账号控制台为准。

使用普通百炼按量 API Key。Coding Plan / Token Plan 的专用密钥、接入地址及适用范围另有规定。API Key、业务空间和接入地址必须属于相同地域。

## 配置项目

编辑已有的项目根目录 `.env.local`，保留原有 `AUTH_SECRET` 与数据库配置，只更新下列字段。将 `YOUR_API_KEY` 与 `YOUR_WORKSPACE_ID` 替换为实际值。

```dotenv
RESEARCH_MODE=live
MODEL_API_KEY=YOUR_API_KEY
MODEL_BASE_URL=https://YOUR_WORKSPACE_ID.cn-beijing.maas.aliyuncs.com/compatible-mode/v1
MODEL_NAME=qwen-plus

# 留空时复用 MODEL_API_KEY 和 MODEL_BASE_URL。
EMBEDDING_API_KEY=
EMBEDDING_BASE_URL=
EMBEDDING_MODEL=text-embedding-v4
```

Base URL 填到 `/compatible-mode/v1`，项目会自动补充 `/chat/completions` 和 `/embeddings`。不要将完整聊天接口路径填入 Base URL。

北京地域的旧地址 `https://dashscope.aliyuncs.com/compatible-mode/v1` 目前仍受官方支持；新配置优先使用控制台业务空间对应的专属地址。

`.env.local` 已被 Git 忽略，密钥仅在服务端使用。不要改成 `NEXT_PUBLIC_*` 配置，也无需把密钥发到聊天中。

## 重启与验收

1. 停止正在运行的项目，再执行 `pnpm dev`，打开 `http://localhost:3000/research`。
2. 确认顶部显示“真实模型模式”。这个标识说明配置模式，连接成功需要通过下一步实际请求确认。
3. 创建一个新的调研项目，填写公开 GitHub 仓库地址。
4. 重新导入 `examples/editor-requirements.md` 等示例文档，等待向量生成成功。演示向量与真实 Embedding 属于不同空间，旧文档需要重新导入。
5. 提问：“请先检索项目文档，再查询仓库与相关 Issue，结合我们对 React 和中文输入的需求，分析接入风险，并引用来源。”
6. 核对工具执行、流式报告、引用原文、历史与 Markdown 导出。模型若没有调用工具，应进一步核对提问和返回内容，不能仅以生成文字判断检索成功。

项目对真实向量请求按每批最多 10 条顺序处理，以适配 `text-embedding-v4` 的批量限制；保留全部批次的统一超时、取消、响应校验和失败处理。数据库未固定向量维度，可以保存该模型默认的 1024 维向量。

## 常见配置问题

- `401` 或鉴权失败：核对普通 API Key 是否有效、地域与业务空间是否匹配。
- 模型不存在或无权限：核对模型名称、当前地域的可用模型和密钥访问范围。
- `429`：检查账户用量、余额及平台限流信息，稍后重试。
- 导入成功但找不到旧文档：确认已在真实模式重新导入，且未再次更换 Embedding 模型或服务地址。

## 官方依据

- [首次调用千问 API](https://help.aliyun.com/zh/model-studio/first-api-call-to-qwen)
- [获取与配置 API Key](https://help.aliyun.com/zh/model-studio/get-api-key/)
- [Function Calling](https://help.aliyun.com/zh/model-studio/qwen-function-calling)
- [Chat 兼容接口与地域地址](https://help.aliyun.com/zh/model-studio/qwen-api-via-openai-chat-completions)
- [Embedding 兼容接口、维度与每批条数](https://help.aliyun.com/zh/model-studio/embedding-interfaces-compatible-with-openai)
- [普通按量 Key 与专用计划 Key 的区别](https://help.aliyun.com/en/model-studio/get-api-key)
