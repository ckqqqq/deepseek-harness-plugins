# 反馈记录

每次运行生成一个本地 Markdown 报告和 feedback.json；另在 activity.jsonl 追加实际浏览动作，供下次核对速率预算。按 Asia/Singapore 记录观察时间，保留来源时间原始时区或“未知”。只存公开可见内容的必要证据，不保存账号凭证。

## feedback.json 字段

```json
{
  "observed_at": "2026-10-09T15:00:00+08:00",
  "coverage": {"platforms": [], "queries": [], "detail_pages": 0, "limitations": []},
  "feedback": []
}
```

每条 feedback 使用：id、platform、url、source_kind（post/comment/answer）、published_at（未知用 null）、product_match、category、summary、evidence_excerpt、environment（version/model/os 可为 null）、evidence_status（reported/documented/reproduced）、severity、severity_reason、duplicate_of（没有用 null）、next_experiment。评论无独立链接时记录主帖链接以及定位用的短句/展示名，并注明不能直达评论。

严重度使用：blocking（无法继续工作）、degraded（可继续但明显受影响）、minor（局部体验问题）、unknown（信息不足）。情绪强烈不等于严重度高；重复反馈、截图和日志也不自动代表已独立复现。

## activity.jsonl

每行记录一个实际动作：at、platform、action（open_site/search/open_detail/scroll_results/scroll_comments）、url。不要预填未执行动作。20 秒间隔按最近受限动作时间计算；小时预算按最近 60 分钟记录计算。新运行发生登录或限流阻断时，报告中说明阻断原因与未完成范围。

## 与性能分析器衔接

把反馈转成实验假设而非直接改代码：例如“工具慢”需要分别测 tools/execute 和 call-to-result；“长任务后变慢”需要比较上下文长度、压缩与重试；“后台代理消耗高”需分别跟踪父子 session。没有真实 session 或运行日志时，仅给出采集建议，不能报告已定位根因。
