# 调研接口与事件协议

入口前缀为 `/api/research`，实现集中于 `app/api/research/[...path]/route.ts`。所有资源接口均依赖当前会话；文档、运行和导出操作必须通过所属项目的用户权限校验。具体错误文本与限制以代码为准。

当前配置限制：单文件 1 MiB、每项目最多 20 份文档、单次问题最多 3000 字符、Agent 最多 6 步、每文件最多 256 个片段。限制常量位于 `lib/research/config.ts`。

## 配置与项目

- `GET /config`：返回执行模式、模型名、检索模式、当前用户及文件 / 步数限制。
- `GET /projects`：返回 `{ projects }`，仅包含当前用户项目。
- `POST /projects`：JSON 输入 `{ name, description, repository }`，返回 `{ project }`。
- `GET /projects/:id`：返回 `{ project, documents, runs }`。
- `DELETE /projects/:id`：删除当前用户项目及关联资源。

项目 ID、文档 ID、运行 ID 都是资源定位符，不能作为授权凭证。

非 GET 请求带有 `Origin` 时，需与浏览器面向的 `Host` 对应来源相符。反向代理改变内部请求地址时，可以设置 `APP_ORIGIN` 明确外部来源；不能只按框架内部归一化后的 `request.url` 判断浏览器来源。

## 文档

- `POST /projects/:id/documents`：`multipart/form-data`，单文件字段名 `file`；支持 Markdown / TXT，返回 `{ document }`。
- `GET /documents/:id`：返回 `{ document, content }`，用于核对原文。
- `DELETE /documents/:id`：删除资料及相应检索片段。

文档元信息包含处理状态、分块数量、字符数量、创建时间及可选错误。一次上传失败应保留可理解的错误反馈。

## 调研运行

- `POST /projects/:id/runs`：JSON 输入 `{ prompt }`，返回 `text/event-stream`。
- `GET /runs/:id`：返回 `{ run }`，可读取持久报告、工具和来源。
- `POST /runs/:id/cancel`：请求取消当前用户的运行，返回 `{ run }`。
- `GET /runs/:id/export`：返回 Markdown 下载内容。

重新发起同一个问题会创建新的运行记录，不应篡改原有失败记录。运行状态使用 `running`、`completed`、`failed`、`cancelled`。

## SSE

每条消息使用 `data: <JSON>` 与空行分隔。JSON 是 `ResearchEvent` 联合类型，由 `type` 区分：

```text
data: {"type":"text","delta":"报告的新增文字"}

data: {"type":"source","source":{"id":"...","title":"...","kind":"document","excerpt":"...","retrievedAt":"..."}}
```

- `run`：初始运行记录。
- `tool`：工具状态更新；同一工具 ID 应更新现有记录。
- `source`：可回查来源。
- `text`：文本增量。
- `done`：最终运行记录。
- `error`：错误消息及可用的运行记录。

前端解析时需要处理跨网络分块的半条 SSE 消息，不能假设一次 `read()` 就是一条事件。取消前端读取与取消服务端执行需要分别处理。准确类型定义见 `lib/research/types.ts`。
