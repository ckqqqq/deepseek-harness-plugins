# 开发与贡献

## 修改时间分析器

```sh
cd dsh-time-profiler
npm ci
npm test
npm run build:viewer
```

`src/analyzer.js` 折叠历史事件；`src/runtime-timing.js` 记录单调时钟区间；`src/history.js` 增量回放选中 session；`src/catalog.js` 查询标题和工作区；`src/live-server.js` 提供 loopback 接口；`viewer/dashboard.html` 是可视化源码，`dashboard.html` 是生成文件。修改模板后提交对应生成文件。

测试不调用真实 LLM。若相邻目录有已经构建的 `deepseek-harness`，可运行 `npm run test:integration` 检查真实 Cordis 事件与生命周期。GitHub CI 不运行这项需要相邻仓库的集成测试。

修改计时逻辑时说明：计时起止事件、时钟来源、并行区间处理、失败与取消处理，以及历史数据是否支持该指标。使用完整变量名，注释解释难以从代码看出的指标口径。模型尝试时间不等于服务端推理时间；call-to-result 不等于纯工具执行时间。

## 第三方插件

第三方目录是 submodule，不在根仓库重新归属为原创代码。更新时先检查上游差异和 DSH 兼容性，再显式提交新的 gitlink。不要清除已有本地修改。

```sh
git submodule status
git -C dsh-webbridge status --short
```

## 提交与数据

每个提交对应具体功能、修复或文档变化。新工作使用实际提交日期；历史补录日期的来源见 README。不要提交 API key、真实对话正文、下载的 session JSON、截图或生成的测量报告。提交前检查 `git diff --cached --check` 和待提交文件清单。
