# DeepSeek Harness 插件集

个人维护的 DSH 插件与第三方插件学习集合。当前自研插件为 `dsh-time-profiler`，用于指定 session 的历史和实时延迟分析；其他三个目录以 Git submodule 保留上游作者与历史。本项目不隶属于 DeepSeek。

## 获取和使用

```sh
git clone --recurse-submodules https://github.com/ckqqqq/deepseek-harness-plugins.git
cd deepseek-harness-plugins/dsh-time-profiler
npm ci
npm test
npm run build:viewer
dsh plugin --profile web add "$PWD"
```

插件安装后在无运行任务时重启对应 DSH profile。打开 http://127.0.0.1:8767/dashboard.html，在工作区侧栏选择对话。完整说明见 [时间分析器](dsh-time-profiler/README.md)。

## 插件目录

| 插件 | 来源 | 用途 |
|---|---|---|
| dsh-time-profiler | 本仓库开发 | session 历史回放、LLM 与工具计时、时间线与工作区面板 |
| dsh-anchored-flash | https://github.com/ruler770525/dsh-anchored-flash | agent 预设学习 |
| dsh-routing-suite | https://github.com/yjh051108/dsh-routing-suite | 路由与运行时装配学习 |
| dsh-webbridge | https://github.com/bill9109/dsh-webbridge | 真实浏览器工具桥接 |

第三方插件使用各自的许可证，兼容性应以对应 DSH 版本为准；收录不代表已适配当前运行时。

## 历史补录说明

仓库首次整理于 2026-10-09。补录提交的 author date 使用本地文件修改时间，committer date 保留实际提交时间。三个第三方目录的本地文件时间为 2026-08-19，分析器文件为 2026-10-09。它们表示本地快照时间，不能证明原始开发或下载日期。没有记录支持的中秋或国庆日期不额外填造；第三方实际历史保留在 submodule 上游仓库。

测试数据、真实会话历史、截图、依赖目录与编译产物不上传。分析器报告中的历史事件间隔不能替代精确 LLM 请求时间，工具并行耗时不能直接相加作为任务总耗时。
