# Agent 耗时分析：开源实现学习笔记

调研日期：2026-10-09。这里只借鉴设计并独立实现本地查看器，没有复制第三方源代码或引入其运行服务。

| 项目 | 阅读内容 | 本插件的借鉴 |
| --- | --- | --- |
| [dsh-langfuse](https://github.com/TtTRz/dsh-langfuse/blob/17c8cd5e2512a4dbee7cf569bdd058bb6a03d090/src/projection.ts) | 将会话事件折叠为 turn、generation、tool span，按事件时间关闭区间；从 assistant 的 timed stream 提取首次输出时间 | 使用事件时间和 callId 配对，按轮次、步骤展示工具；保持指标定义明确 |
| [Phoenix TraceTree](https://github.com/Arize-ai/phoenix/blob/bc474eff80202151f16d3c8a585c8e43735d86a7/js/app/src/components/trace/TraceTree.tsx) | 可折叠调用树、选中节点、显示 latency 和状态 | 新增步骤工具折叠、点击工具查看起点、耗时与结果 |
| [Langfuse](https://github.com/langfuse/langfuse) | LLM 应用的 tracing、评估和观测平台，dsh-langfuse 将数据投影到其 OTel 接口 | 学习 trace/span 概念；本地页面继续离线使用，不接入服务端 |

## 先理解 trace 和 span

Trace 是一次完整执行，span 是其中一个有开始、结束和父节点的操作。DSH 的 turn 可作为整次执行，step 是其子区间，工具调用按 step 分组。当前报告没有记录工具之间的真实父子关系，因此不能根据时间包含关系推断“工具 A 调用了工具 B”。界面中的工具缩进只表示所属步骤。

## 指标命名比图表数量更重要

dsh-langfuse 的 beginGeneration 从 step/start 开始，endGeneration 在 step/end 关闭；这个 span 区间包含整个步骤，不应未经核对就当成纯模型 HTTP 延迟。它从内嵌 stream 提取首次输出时间；若起点仍是 step/start，起点到首次输出也可能包含请求准备。本插件继续将现有指标命名为 stepToAssistantMs，不声称它是 TTFT。

## 这次已经落地

1. 步骤内的工具调用可折叠，减少长时间线的视觉噪声。
2. 点击工具名称查看起点、耗时、成功/失败和计时范围。
3. 指定基准轮次，显示整轮变化量和百分比，以及每种工具平均耗时和调用次数变化。
4. 重复导入同一 sessionId、turn、startedAt 的报告会替换原记录，避免对比表重复。
5. 演示与实际报告不能进行同组差异比较，时钟异常暂停差异计算。

## 如何学习和进一步维护

先读本项目 analyzer.js，理解事件如何配对；再读 dsh-langfuse 的 beginTurn、beginGeneration、beginTool、endTool，比较它如何把同样的事件变成 OTel span。最后读 Phoenix 的 SpanNode 与 CollapseToggleButton，理解树节点的选择和折叠状态。

后续若需要真正的 provider 请求耗时，应围绕 llm/stream 或 live assistant attempt 的开始/结束建立独立计时，记录单调时钟、attempt id 和会话关联，并覆盖取消与重试。若需要 CPU 热点，应接 CPU profiler；trace 的 elapsed time 无法直接告诉你 CPU 花在了哪里。
