# 我花了 8 块钱 token，把一张破 Excel 变成了会说话的 Agent

> 又名：《从脚本到 Agent，我踩过的 3 个坑与想明白的 1 件事》

---

## 0. 故事从一张 Excel 开始

上周五下班前，运营小张又发来了那张熟悉的 Excel：

**300 行工具链接，每一行是段 HTML，我要把它们解析成结构化 JSON 塞进小程序源码，再扫个预览码发回去。**

这是我这个月第 7 次干这事。  
每次 30 分钟起步，手动走完整个 12 步流程：

```
打开 Excel → Ctrl+F → 复制 <a> 标签 → 贴到脚本 →
手动清 &nbsp; → 运行 → 看报错 → 改脚本 → 再跑 → 
粘贴到 parsed-links-output.js → 打开微信开发者工具 → 
扫预览码 → 截图发给运营
```

这个周末，我把它改造成了这样：

> 🎬 **[此处插入 GIF：左边手动 12 步 / 右边拖一下 + 说一句话]**

她上传文件，我用一句"给我看 type 分布"就能查数据；发"拉个预览码"就能拿到二维码。

更重要的是：**它能听懂"type 分布"这种模糊需求**，而这在以前意味着我得再写一个脚本。

下面我讲讲这个"从脚本到 Agent"的完整演化。以及我在 LangChain.js 里踩的 3 个坑。

**先给底：** 整个项目约 600 行代码，DeepSeek 一次请求成本 < 0.001 元。

---

## 1. 一个真实到让我想删号的需求

先把场景说清楚。我们团队是做小程序客服工具的。每个版本都要把几百个"工具卡片"的跳转配置写进代码里。

运营同学维护的是一张 Excel，长这样：

| 工具名称 | 工具链接 | 类型 | 备注 |
|---|---|---|---|
| 查快递 | `<a data-miniprogram-appid="wxabc" data-miniprogram-path="pages/ship">点此</a>` | smallProgram | … |
| 预约 | `<a href="https://x.com/form?id=123" type="form">立即预约</a>` | form | … |
| 热线 | `<a href="tel:10086">拨打</a>` | tel | … |

我要做的事：

1. 读这张 Excel → 找出「工具链接」那一列
2. 把每行的 `<a>` 标签解析成 `{ name, type, href?, appid?, path?, formid? }`
3. 汇总成数组，写到小程序项目里 `pages/test-url/parsed-links-output.js`
4. 在微信开发者工具里拉一个预览码截图给运营

听起来是个脚本活儿。我最开始也确实只写了个脚本。

---

## 2. 我用纯脚本写了第一版——然后它挂了 3 次

脚本逻辑非常朴素：

```js
// 伪代码
const rows = xlsx.read(file);
const linkColIdx = rows[0].indexOf('工具链接');   // ← 定位列
const links = rows.slice(1)
  .map(r => parseAnchor(r[linkColIdx]))            // ← 正则解析 <a>
  .filter(Boolean);
fs.writeFileSync('output.js', `export default ${JSON.stringify(links)}`);
```

上线第一周，三次故障：

> ❌ **事故 1**：运营把列名从"工具链接"改成"跳转链接" → `indexOf` 返回 -1 → 全表空结果 → 我下班前才发现。

> ❌ **事故 2**：有一行 HTML 手写时漏了闭合引号 `<a href="..>`，我的正则吃不下 → 该行被 silent 丢弃。运营看到上线后的小程序少了一个按钮，来质问我。

> ❌ **事故 3**：QA 顺口问："能不能告诉我这张表里有多少条 H5 类型？" 我"吭哧吭哧"又写了个脚本过滤 type 字段。

三次故障指向同一件事：**脚本解决的是确定性问题，可我的需求一半是模糊的。**

这句话是这篇文章的**第一个关键洞察**。请把它记下来，我们还会回来。

---

## 3. 把"模糊"交给 LLM 的三个地方

我想清楚一件事：**不需要用 LLM 替代代码，只需要把"模糊匹配"的环节交给它**。

盘点下来，这个场景里有 3 个"模糊点"刚好对应 LLM 的强项：

| 位置 | 之前做法 | 改造后 | 单次成本 |
|---|---|---|---|
| ① 识别列名 | `indexOf('工具链接')` | LLM 把表头映射到 schema | < 0.0001 元 |
| ② 正则兜底 | 解析失败 → 丢弃 | 失败 tag 喂给 LLM 修复 | 0.001 元/批 |
| ③ 查数据 | 再写脚本 | Agent + 工具调用 | 0.01 元/轮 |

下面一个个讲。

---

### 3.1 让 LLM 来"找那一列"

核心代码就这段（保留降级逻辑，以防 API Key 没钱）：

```js
async function mapHeadersToSchema(headers) {
  const llm = getLLM();
  if (llm) {
    try {
      const prompt = `把下面这组 Excel 表头映射到 schema，返回 JSON：
${JSON.stringify(headers)}

schema 字段：link / name / type / appid / path / formid
每个字段返回列索引（0-based），不存在则返回 -1。
常见同义词：link 可能叫"工具链接""跳转链接""URL""地址"…`;

      const resp = await llm.invoke(prompt);
      const json = extractJson(resp.content);
      if (json && json.link >= 0) return json;
    } catch (e) { /* 余额不足 / 网络超时 → 降级 */ }
  }

  // 降级：关键字匹配（每个字段带一组同义词）
  return keywordMatch(headers);
}
```

**为什么不直接上 LLM？** 因为我不想每次都被 API 余额勒索。`DEEPSEEK_API_KEY` 没配或余额不足时，自动降级到关键字匹配——**不影响主流程可用性**。

> 💡 **设计原则**：任何 LLM 调用都要配一个"代码版的降级路径"。这是把 LLM 用进生产环境的底线。

---

### 3.2 让 LLM 修复"坏掉的 HTML"

正则解析完后，我会得到两个数组：

```js
function parseLink(html) {
  return { parsedLinks, failedTags };  // 成功 & 失败各一堆
}
```

对 `failedTags` 做一次二次调用：

```js
async function repairFailedAnchorTags(failedTags) {
  if (!failedTags.length) return [];
  const llm = getLLM();
  if (!llm) return [];

  // 20 条一批，控制单次 prompt 大小
  const BATCH = 20;
  const repaired = [];
  for (let i = 0; i < failedTags.length; i += BATCH) {
    const batch = failedTags.slice(i, i + BATCH);
    const prompt = `把下面这些有语法错误的 <a> 标签解析成标准对象：
${JSON.stringify(batch.map(t => t.raw))}

字段：{ name, type: 'h5'|'smallProgram'|'tool'|'form'|'scheme'|'tel',
        href?, appid?, path?, formid? }
无法解析的位置返回 null，保持数组长度一致。`;

    const resp = await llm.invoke(prompt);
    const arr = JSON.parse(extractJsonArray(resp.content));
    repaired.push(...arr.filter(Boolean));
  }
  return repaired;
}
```

上线后的数据：**失败修复率从 0% 提升到 ~82%**（18% 是 LLM 也认不出来的真垃圾数据，该让运营修就让她修）。

---

### 3.3 让 Agent 自主调用工具回答问题

前面两个都是"LLM 在代码里当配角"，到这里我才真正用上了 Agent。

Agent 的本质是：**告诉 LLM 你有哪些工具，LLM 自己决定什么时候用、怎么用、用完怎么组织结果。**

三个工具声明（伪代码简化）：

```js
const parseExcelTool = tool(
  async ({ filePath }) => { /* 解析 + 写 data.json */ },
  { name: 'parse_excel_to_json', schema: z.object({ filePath: z.string() }) }
);

const fetchPreviewTool = tool(
  async () => { /* 请求本地 30747 接口 → 落盘图片 → 返回 URL */ },
  { name: 'fetch_preview_qr', schema: z.object({}) }
);

const queryDataJsonTool = tool(
  async ({ filterType, limit }) => { /* 读 data.json → 统计/过滤 */ },
  {
    name: 'query_data_json',
    schema: z.object({
      filterType: z.string().optional(),
      limit: z.number().optional(),
    })
  }
);

const agent = createAgent({
  model: llm,
  tools: [parseExcelTool, fetchPreviewTool, queryDataJsonTool],
  systemPrompt: '你是文件处理助手，需要时主动调用工具，不要假设结果。',
});
```

就这样。用户发一句"给我看 type 分布"，LLM 自己会去调用 `query_data_json({})` 拿回统计，组织成表格回复。

配一张聊天界面截图：

> 🖼 **[此处插入截图：用户提问 + Agent 回复 + 可点击展开的"工具调用"chip]**


## 4. 做完之后我发现的 3 件事

### ① Agent 不是"更聪明的 Chat"，是"更自由的工作流"

以前做工作流要用 n8n / Zapier，画节点、连线、配触发器。  
现在一句 system prompt 代替了整张节点图。

用户"重新拉一次预览码"这句话，在过去是**至少 5 个节点**的工作流。现在只是 Agent 心中的一次 `fetchPreviewTool()` 调用。

### ② LLM 的核心竞争力是做"胶水层"

- 要 LLM 帮你**重构代码**？不如 IDE 插件。
- 要 LLM 帮你**写正则**？不如你自己写。
- 要 LLM 把一堆**散落的小工具粘成一个听得懂人话的入口**？无可替代。

**代码负责确定性，LLM 负责语义。** 这句话送给你，截图转发随便。

### ③ Token 真的不贵

全流程——从识别列名、修复失败链接、到对话查询——单次成本 **0.003 元**。

跟脚本版相比，LLM 版：
- 每月帮我省 **~2 小时**（按 7 次 × 15 分钟计算）
- 每月 token 花销 **~0.2 元**
- 运营同学拿到一个"可对话"的工具，体验跃升一个档

**ROI 是三个数量级的差距。**

---

## 6. 源码 & 如何复现

项目结构很简单：

```
mini-proj/
├── public/
│   ├── index.html       # 网页 UI（含对话侧栏）
│   └── data.json        # 解析结果（运行时生成，对外可访问）
├── src/
│   ├── server.js        # Express：3 个接口 + 全局错误兜底
│   ├── agent.js         # LangChain.js Agent + 3 个 Tool
│   ├── excelParser.js   # xlsx 读表 + 正则解析 <a>
│   └── llm.js           # 表头 schema 映射 + 失败 tag 修复
├── temp/                # 预览码图片落盘
└── uploads/             # 原始 Excel 落盘
```

启动：

```bash
git clone <repo>
cd mini-proj && npm install
cp .env.example .env      # 填入 DEEPSEEK_API_KEY
npm start
open http://127.0.0.1:3000/
```

---

## 7. 最后说两句

AI Agent 这波浪潮里，大家容易被"autonomous"、"multi-agent"、"memory"这些词带偏。

但真正能在工作流里立刻生效的 Agent，**起步点往往就是把一个内部工具从"脚本"升级成"能听懂人话的脚本"**。

别被"从零写个 AutoGPT"吓退。  
你的第一个有用的 Agent，可能就躲在你最烦的那个重复劳动里。

---

> 📦 **完整源码 + 可运行 Demo**：[GitHub repo 地址]  
> 💬 **一起讨论**：留言区 / [Issue 区地址]  
> 🌟 **如果对你有启发**，点个赞、转发给那个被 Excel 折磨的同事。

