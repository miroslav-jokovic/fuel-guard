# Message to Anthropic support — undeclared tool search (2026-11-11)

Send from the account that owns the API key Ask AI uses. Contains no carrier data.

---

**Subject:** Haiku 5.5 runs tool_search_tool_regex on a request that declares no tool search

Hello,

We call the Messages API with `claude-haiku-5-5` and 25 ordinary custom tools: no `defer_loading` on any
tool, no `tool_search_tool_*` entry in `tools`, no beta headers. Request settings:
`output_config: { effort: "medium" }`, top-level `cache_control: { type: "ephemeral" }`, a two-block
system prompt, `max_tokens: 8000`, non-streaming, TypeScript SDK.

On some questions the response content holds a server-side tool search we never declared:

```
{"type":"thinking","thinking":"","signature":"…"}
{"type":"server_tool_use","name":"tool_search_tool_regex","input":{"pattern":"fill|fuel|flag"}}
{"type":"tool_search_tool_result","content":{"type":"tool_search_tool_search_result",
  "tool_references":[card_holds, count_signal, finance_report, fleet_summary, fuel_economics]}}
```

That is the documented default of 5 results, and the tool that answers the question (`top_risk`,
described as "The drivers or vehicles with the most flagged fills in the period") is not among them,
so the model replies that no tool can answer. It does so on every run (3 of 3). At `effort: "low"` the
same happens on more questions.

The tool search documentation describes the tool as opt-in (declare it, mark tools `defer_loading`).
Our questions:

1. Why does tool search run on a request that does not declare it? Is it automatic for Haiku 5.5 above
   some number or size of tools?
2. How do we keep every tool loaded, so the model always sees all 25 definitions?
3. If it stays, can the result cap be raised from our side?

Thank you.
