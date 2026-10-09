# 实时分析排障

## 找不到 session

确认面板连接的是安装插件的同一个 DSH profile。8767 面板与 3080 工作区是两个入口，采集插件运行在 DSH host 内。列表同时包含持久化历史和已加载 session；使用真实标题与工作区路径确认目标，避免只凭相似标题选错。标题默认每 30 秒刷新，运行状态每秒刷新。

## 页面显示旧版本

先刷新浏览器。源码安装读取 src/index.js；本地编译安装使用 profile 中指定的 lib/index.mjs。修改源码后需更新对应产物。若热更新失效，确认没有运行任务后重启对应 profile。不要直接终止正在执行的长任务。

## 看不到 LLM 时间构成

历史事件日志只包含事件时间，无法重建插件挂载前的单调时钟模型尝试和工具执行区间。历史报告仍能展示整轮、步骤和 call-to-result 时间。从插件加载后的新轮次开始，才会采集 runtimeTiming。其他时间包含未插桩工作，不等同于框架 CPU 时间。

## 端口冲突或连接失败

在 profile patch 中调整插件的 live.port。查看 host 日志中的 live viewer 地址，并访问该端口的 dashboard.html。插件只监听 127.0.0.1，不提供跨站 CORS；请从面板自身页面访问 API。

## 数据导出与删除

“下载该对话历史 JSON”包含正文和工具参数；时间报告只保留计时、工具名与 session 标识。两者都应按会话数据管理。离线报告位于配置的 outputDirectory，删除报告文件不会删除 DSH 原始 session；原始日志由 DSH 持久化服务管理。

## 接口检查

```sh
curl 'http://127.0.0.1:8767/api/sessions'
curl 'http://127.0.0.1:8767/api/live?sessionId=YOUR_SESSION_ID'
```

先验证列表中的标题、workspace、id，再请求单一 session。不要把 API 原始响应中的真实对话或本地路径直接贴到公开 issue。
