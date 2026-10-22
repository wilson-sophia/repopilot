# 如何阅读提交记录

项目保留 Vercel Chatbot 的来源基线，新增代码按可解释的阶段提交。阅读历史时先确认上游提交，再看本项目的功能与修复；不要把模板已有能力当作本项目从零实现的功能。

## 提交格式

采用 `type(scope): description`：

- `chore`：环境、依赖和自动化准备。
- `feat`：可使用的新功能。
- `fix`：实际问题的修复。
- `test`：测试与验证工具。
- `docs`：开发记录和学习材料。

`scope` 使用具体模块，如 `research`、`db`、`ui` 或 `ci`；描述说明改动后的行为。具体提交数量与哈希以仓库历史为准，本文件不预填尚未发生的提交。

## 学习时这样使用

已完成的代码阶段如下，后续文档提交与远程 CI 状态另行记录：

- `a572f49`：`feat(research)`，调研领域、工具流程与持久化接口。
- `5eb41ee`：`feat(workspace)`，工作台 UI、交互与来源核验。
- `7678ea0`：`test(research)`，回归测试、评测与 CI。
- `f2178bc`：`fix(runtime)`，生产环境、会话、数据库生命周期与构建边界修复。

```bash
git log --oneline --decorate
git show <commit>
git diff c2f8235e1f3ea903ad8b7f61447c4f74164b5c58..HEAD -- lib/research components/research scripts
```

先读某个阶段提交的说明，再对照 [DEV_LOG.md](DEV_LOG.md) 中的问题与决策，最后跑对应测试。遇到难以理解的函数，可以使用 `git log -- <path>` 查看它何时引入与为何修改。

## 对外解释贡献

讲清楚三个层次：继承了哪些模板基础、新增了哪些业务能力、通过哪些测试验证。开发记录中的失败与修复同样值得保留，例如模型 SDK 依赖对齐、浏览器来源判断和数据库跨进程持有；这些内容能体现定位问题与检验设计的过程。

环境密钥、本地数据库、依赖目录与构建缓存不属于源码提交。测试结果的可读摘要与非敏感评测快照保存在 `docs/VERIFICATION.md` 与 `docs/evidence/`。
