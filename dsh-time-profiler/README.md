# DSH 时间性能分析插件

这是一个独立的 Cordis host 插件，使用当前本地 deepseek-harness 的 `session/event` 和 `session/disposed` 扩展点。无需构建、无需 API key 即可测试，不修改 dsh 核心代码，也不注册模型工具。

## 安装和运行

在已安装 dsh 的终端中执行（这里以 web profile 为例，按实际使用的 profile 替换）：

```sh
dsh plugin --profile web add ./deepseek-harness-plugins/dsh-time-profiler
dsh --profile web
```

DSH 的插件管理命令会将带有 `dsh.bundle.patch` 的依赖加入 profile 的 bundles。重新启动后开始观测新轮次。插件运行期间，每次 `turn/end` 都异步写入同名的 JSON 与 HTML，并在 host 日志里给出 HTML 路径。默认写入 host 进程当前目录下的 `dsh-performance`。

## 可视化查看

参考开源 trace 工具，页面支持折叠步骤下的工具，并点击工具查看调用区间。选择“基准轮次”可查看整轮耗时变化和各工具平均耗时变化；重复导入同一轮报告会替换原记录。演示与实际报告不能混合比较，存在时钟异常时暂停差异计算。源码阅读与设计分析见 [开源学习笔记](docs/open-source-study.md)。

双击输出目录里的 `turn-*.html` 即可查看对应轮次，不需要启动服务或联网。页面包含整轮时间线、步骤明细、工具累计/平均/最大耗时排名以及轮次比较。失败工具带有“失败”文字和红色时间条，工具与步骤使用同一个时间坐标，便于识别并发重叠。所有耗时均带单位。

也可以打开插件目录中的 `dashboard.html`，点击“导入报告”一次选中多份 JSON，通过轮次下拉框或比较表切换报告。导入的数据只保留在页面内存中，刷新后需要重新导入。“查看演示数据”显示两份明确标记的模拟报告，不代表真实 dsh 测量结果。页面支持浅色/深色系统主题和窄屏布局。

单个导入文件限制为 10 MB，最多 10000 个步骤或工具调用。导入失败会显示文件名与原因，并保留已有报告。页面使用文字节点显示会话和工具名称，嵌入 JSON 会转义脚本分隔字符。报告含会话标识和工具名称，分享生成的 HTML 等同于分享这些报告数据。

修改 `viewer/dashboard.html` 后运行 `npm run build:viewer` 更新空白查看器；插件生成的新 HTML 会直接使用最新模板。历史 HTML 是独立快照，不会自动更新。

要指定输出目录，在 profile 的 `cordis.patch.yml` 中覆盖配置：

```yaml
- id: time-profiler
  config:
    outputDirectory: /tmp/dsh-performance
```

已通过行为测试及本地仓库真实 Cordis + SessionStore 的插件加载、事件接收、落盘和卸载检查。安装和实际 profile 启动尚需在你的运行环境验证；这些检查不代表真实 API 性能测量。

如果直接使用旁边的 harness 源码，可以无需安装插件，通过 source overlay 启动：

```sh
cd ./deepseek-harness
pnpm dsh --profile web --patch ../deepseek-harness-plugins/dsh-time-profiler/cordis.source.patch.yml
```

## 如何理解报告

| 字段 | 含义 |
| --- | --- |
| `durationMs` | 从 turn/start 到 turn/end 的整轮经过时间 |
| `steps[].durationMs` | 一个 step 从开始到结束的时间；未结束则缺省 |
| `steps[].stepToAssistantMs` | step 开始到最后一个 assistant/message 或 assistant/attempt 的时间，包括请求准备、生成、重试等待 |
| `steps[].attempts` | 记录下来的 assistant/message 和 assistant/attempt 数量 |
| `tools[].durationMs` | tool/call 到对应 tool/result 的经过时间，包括审批、排队和结果处理 |
| `toolsByName` | 按工具名称汇总 count、totalMs、meanMs、maxMs、errors，按累计耗时降序 |
| `unfinishedToolCount` | 轮次结束时仍未收到结果的工具数量 |
| `clockAnomaly` | 已测区间是否出现负值；调整系统时间可能影响结果 |

例如，整轮耗时 10 秒，两个并发工具分别耗时 6 秒和 5 秒，它们的累计耗时是 11 秒。这并不意味着整轮至少耗时 11 秒，因为两个区间重叠。嵌套工具也可能重叠，所以不要用工具累计耗时去相减计算“框架开销”。

这个版本分析可观察的经过时间，不是 CPU profiler，不测首 token 延迟，也不拆分网络、服务端推理和框架内部开销。要判断慢在哪里，先比较 step 时间和工具时间，再对可疑部分进行更细的插桩。

## 实现导读与限制

`src/analyzer.js` 按 session id 保存当前轮次，再按 callId 将工具请求与结果配对。工具参数、提示词和结果正文不进入报告。`src/index.js` 用 Cordis 的 effect 管理清理，并异步写入每轮独立文件；卸载时等待已排队写入完成。`src/visualization.js` 把报告嵌入 `viewer/dashboard.html`，生成无外部依赖的查看页面。

运行时单调时钟只统计加载后完整观测到 start 的轮次；实时页面通过 sessionQuery 回放历史事件，历史报告标记 measurementSource=history，不能补出精确请求计时。会话销毁或插件卸载时，未结束轮次的内存统计被清理，不生成完整轮次报告。事件时间来自 DSH 的系统时钟，不是单调时钟。报告包含会话标识与工具名称；文件保留在本地，默认文件权限为 0600。文件数量随轮次增长，需要自行清理。单轮统计和待写文件暂存在内存中；极长轮次或极慢磁盘可能增加内存占用。写入失败会记录 warning；进程崩溃可能丢失待写报告。

```sh
cd ./deepseek-harness-plugins/dsh-time-profiler
npm test
```

测试覆盖并发重叠、重试、工具错误、取消时未完成工具、会话隔离、时钟倒退、文件落盘、卸载等待、磁盘失败，以及图表渲染、轮次切换、多文件导入、无效报告和脚本注入防护。

## LLM / 工具运行时分析

新采集的报告包含 `runtimeTiming`，通过主 agent 的 assistant stream 与 tools/execute 扩展点，用单调时钟记录模型尝试和工具执行区间。页面新增四类时间构成、模型尝试时间线和真实工具执行排名（包括嵌套调用）。`firstOutputMs` 是每次尝试开始到首次非空输出的等待，可能包含 reasoning 或工具增量；不是服务端专属指标。工具统计还包含 p50/p95/max，便于发现长尾。

报告中的 `tools` / `toolsByName` 仍是原来的 call-to-result 计时；`runtimeTiming.toolsByName` 才是调度后执行区间的排名。两者不能混用。模型尝试仍包含流消费和提交，辅助模型调用尚未完整覆盖；其他时间不等于框架 CPU 开销。

任务级汇总：`npm run analyze:task -- <属于同一次任务的 JSON 文件...>`。它累计选中轮次的 active time，排除轮次间空闲；跨并发 session 的汇总是 worker 累计时间，不是任务 wall time。完整的指标定义、优化方法和 pi/Codex 对比协议见 [性能分析流程](docs/performance-workflow.md)。当前尚未实现 pi/Codex 日志适配器，也没有真实任务提速结论。

验证命令：`npm test`；相邻 harness 已构建时可运行 `npm run test:integration`，测试真实 Cordis 的 scoped dispatch、工具 next 委托和文件输出。无需真实模型 API key。

## 指定对话实时分析

bundle 与 source patch 默认启用本地实时服务，地址为 `http://127.0.0.1:8767/dashboard.html`。它与 dsh 的 3080 页面是两个页面，但插件在同一个 dsh 进程内采集事件。安装插件后，如果 profile 开启 HMR，可自动加载；否则在没有运行任务时重新启动 dsh。插件单独调用 `apply` 的默认配置仍关闭实时服务，避免测试或离线使用占用端口。

打开实时页面，在“对话”下拉框选择 session id；页面每秒采样该对话。正在生成的 LLM 和执行中的工具区间会持续延伸，显示当前经过时间；结束后切换为完成报告。暂停刷新会保留图表，继续刷新恢复采样。切换对话会清除旧对话视图，异步到达的旧响应不会混入新对话。可用 `?sessionId=<URL 编码的 session id>` 直接指定对话，或者复制选择后的页面链接。

对话列表包括已加载和持久化存档 session。选中后通过 sessionQuery.observeSession 读取一致的历史事件，释放观察句柄；首次回放完整历史，后续只折叠新增事件，默认展示最近 100 个完成轮次。历史轮次只有事件时间；插件加载前开始的轮次无法补造单调时钟，精确运行时计时需从下一轮开始采集。主/子代理仍是不同 session，不自动合并为整次任务。实时快照只读，不结束 pending span、不改变工具结果或取消信号。

`live` 配置支持 `enabled`、`port`（默认 8767）、`pollIntervalMs`（默认 1000，允许 250..60000）与 `maxRetainedReports`（默认 100，全局保留最近完成轮次数）。内存报告淘汰后，磁盘 JSON/HTML 仍保留。关闭实时服务设置 `live.enabled: false`；端口冲突会导致插件加载失败，需要修改端口。服务只绑定 127.0.0.1，并限制同源读取；没有外部上传。关闭插件会关闭服务并清理保留数据。

实时页面采用串行轮询，不会叠加请求；请求超时后自动重试。旧的离线 HTML 继续支持导入报告，但不连接实时服务。每次采样会计算和序列化所选对话的区间，长轮次有额外开销；可调大 pollIntervalMs 降低采样频率。

## 历史 JSON 与本地安装

选择 session 后点击“下载该对话历史 JSON”，可导出原始 header/events（包含对话正文及工具参数，请按自己的会话文件管理）。分析结果只保留计时字段。API 为 GET /api/history?sessionId=<id>，与实时 API 一样仅允许同源 loopback 请求。磁盘日志可为压缩 JSONL，不应直接改名为 JSON；插件使用 DSH 的查询服务读取对应版本。插件依赖 sessions 和 sessionQuery。

本机 Web profile 已通过 cordis.patch.yml 注册 lib/index.mjs 编译产物，8767 为实时面板。更新源码后，在插件目录使用相邻 harness 的 node_modules/.bin/tsdown src/index.js --no-config --out-dir lib --format esm --platform node 构建；若热更新失效，在没有运行任务时重启 dsh web --no-open。配置备份位于 ~/.dsh/profiles/web/cordis.patch.before-history-profiler.yml。

时间线与排名同时展示中文工具说明和原始名称，例如“执行命令 · bash”。DSH 的 step/start 没有任务名称，步骤动作由该步骤中的工具名称推导；没有工具且已有模型响应时显示“模型生成响应”。不会为步骤编造任务标题，也不读取工具参数作为名称。

实时面板按 DSH 原生 session/title 投影显示对话标题，按 header.cwd 分组工作区，标注子代理和运行状态。标题扫描缓存由 live.catalogRefreshMs 控制（默认 30 秒），每秒更新运行状态。live.theme 可选 system/light/dark，本机设为 dark 与 DSH 工作区一致。侧栏用于选择分析对象，选中对话的完整路径和 session id 显示在面板中。
