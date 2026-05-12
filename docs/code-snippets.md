# 文章用：精选代码片段（已为阅读体验做精简）

> 每段 ≤ 25 行，保留核心意图，去除 try/catch 样板、边界校验、日志。  
> 文章展示时用 carbon.now.sh 生成图片，或直接用 markdown code fence。

---

## Snippet 1：LLM 识别 Excel 表头列

**展示位置**：第 3.1 节

```js
async function mapHeadersToSchema(headers) {
  const llm = getLLM();
  if (!llm) return keywordMatch(headers);  // 降级

  const prompt = `把下面这组 Excel 表头映射到 schema，返回 JSON：
${JSON.stringify(headers)}

schema 字段：link / name / type / appid / path / formid
每个字段返回列索引（0-based），不存在则返回 -1。`;

  try {
    const resp = await llm.invoke(prompt);
    const json = extractJson(resp.content);
    if (json && json.link >= 0) return json;
  } catch (e) {
    console.warn('LLM 不可用，降级到关键字匹配');
  }
  return keywordMatch(headers);
}
```

**讲点**：LLM 调用必须有降级路径，生产可用的最低门槛。

---

## Snippet 2：LLM 批量修复正则失败的 `<a>` 标签

**展示位置**：第 3.2 节

```js
async function repairFailedAnchorTags(failedTags) {
  if (!failedTags.length) return [];
  const llm = getLLM();
  if (!llm) return [];

  const BATCH = 20;
  const repaired = [];
  for (let i = 0; i < failedTags.length; i += BATCH) {
    const batch = failedTags.slice(i, i + BATCH);
    const prompt = `把这些有语法错误的 <a> 标签解析成标准对象：
${JSON.stringify(batch.map(t => t.raw))}

字段：{ name, type, href?, appid?, path?, formid? }
无法解析的位置返回 null，保持数组长度一致。`;

    const resp = await llm.invoke(prompt);
    const arr = JSON.parse(extractJsonArray(resp.content));
    repaired.push(...arr.filter(Boolean));
  }
  return repaired;
}
```

**讲点**：分批（≤20 条）控制 prompt 长度；`null` 保索引对齐。

---

## Snippet 3：创建 Agent 只需要 10 行

**展示位置**：第 3.3 节

```js
const { createAgent } = require('langchain');
const { ChatOpenAI } = require('@langchain/openai');
const { tool } = require('@langchain/core/tools');
const { z } = require('zod');

const queryDataJson = tool(
  async ({ filterType, limit }) => {
    const data = JSON.parse(fs.readFileSync('data.json'));
    const arr = filterType ? data.filter(d => d.type === filterType) : data;
    return JSON.stringify({
      total: data.length,
      filtered: arr.length,
      sample: arr.slice(0, limit ?? 10),
    });
  },
  {
    name: 'query_data_json',
    description: '查询已解析的 data.json：总条数 / 按 type 过滤 / 返回样本',
    schema: z.object({
      filterType: z.string().optional(),
      limit: z.number().optional(),
    }),
  }
);

const agent = createAgent({
  model: new ChatOpenAI({ model: 'deepseek-chat', apiKey: process.env.KEY }),
  tools: [queryDataJson, /* fetchPreviewTool, parseExcelTool */],
  systemPrompt: '你是文件处理助手，需要时主动调用工具。',
});

// 使用：
const r = await agent.invoke({
  messages: [{ role: 'user', content: 'data.json 里 h5 有几条？' }],
});
console.log(r.messages.at(-1).content);   // "共 48 条 ..."
```

**讲点**：Agent 的本质就是"工具声明 + 系统提示词"。  
核心 API 只有 `tool()` 和 `createAgent()`。

---

## Snippet 4（可选）：前端 2 行识别工具调用结果，内嵌图片

**展示位置**：如写工程落地章节

```js
// Agent 返回的 toolCalls 里带 result
// 遇到 fetch_preview_qr → 直接在气泡里渲染二维码
toolCalls.forEach(c => {
  if (c.name === 'fetch_preview_qr' && c.result?.publicUrl) {
    bubble.append(`<img src="${c.result.publicUrl}" alt="预览码" />`);
  }
});
```

**讲点**：工具结果透传给前端，比让 LLM 再复述一遍 URL 稳定得多。

---

## 坑点速查表（文章第 4 节用）

| 问题 | 报错信号 | 解法 |
|---|---|---|
| DeepSeek thinking 模式 tool-call 失败 | `reasoning_content must be passed back` | `DEEPSEEK_MODEL=deepseek-chat` |
| `createReactAgent` 弃用警告 | `deprecated` tslint hint | 升级到 `createAgent from 'langchain'` |
| peerDep 冲突 `@langchain/core` | `ERESOLVE unable to resolve` | 整套升 1.x（core/langchain/openai/langgraph） |
| DeepSeek 402 Insufficient Balance | `HTTP 402` | 充值 / 换 key / 走关键字降级 |
| body-parser 收非 JSON 返回 HTML | 非 `{ok, error}` 格式 | 全局 4 参 error handler |
