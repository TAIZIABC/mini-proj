# 配图与流程图（Mermaid / ASCII）

> 复制下面的 Mermaid 代码到 [mermaid.live](https://mermaid.live) 或掘金/思否编辑器直接用。

---

## 图 1：整体架构（首屏必备）

```mermaid
flowchart LR
    User([运营/开发]) -->|上传 xlsx| Web[Web UI<br/>index.html]
    User -->|自然语言| Web

    Web --> |POST /api/upload| Server[Express Server]
    Web --> |POST /api/agent| Server
    Web --> |GET  /api/preview| Server

    Server --> Parser[excelParser.js<br/>xlsx + 正则]
    Server --> Agent[agent.js<br/>LangChain Agent]

    Parser -->|模糊列识别| LLM1[DeepSeek<br/>deepseek-chat]
    Parser -->|失败 tag 修复| LLM1
    Agent  -->|工具决策| LLM1

    Agent -->|Tool| Parser
    Agent -->|Tool| WeixinDevTool[微信开发者工具<br/>:30747 预览码 API]
    Agent -->|Tool| DataJson[(data.json)]

    Parser -.写.-> DataJson
    Parser -.写.-> AppletSrc[(小程序源码<br/>parsed-links-output.js)]

    style LLM1 fill:#eef2ff,stroke:#4f46e5
    style Agent fill:#f0fdf4,stroke:#16a34a
    style Parser fill:#fef3c7,stroke:#d97706
```

---

## 图 2：一次 Agent 对话的完整链路（核心章节用）

```mermaid
sequenceDiagram
    autonumber
    actor U as 用户
    participant C as 前端 chatLog
    participant S as /api/agent
    participant A as Agent (LLM)
    participant T as query_data_json

    U->>C: "给我看 type 分布"
    C->>S: POST { message }
    S->>A: invoke(messages)
    A->>A: 判断需要工具
    A->>T: query_data_json({})
    T-->>A: { total: 370, typeCount: {...} }
    A->>A: 组织自然语言回复
    A-->>S: { content, toolCalls[] }
    S-->>C: JSON
    C->>U: 气泡 + 工具 chip
```

---

## 图 3：LLM 在代码里的 3 个位置（"LLM 当胶水层"的直观图）

```mermaid
flowchart TD
    Start([Excel 文件]) --> Read[xlsx 读表]
    Read --> Headers{识别<br/>'工具链接'列}

    Headers -->|LLM ①| Schema[schema 映射<br/>link / name / type / appid / path / formid]
    Headers -.API 失败.-> Keyword[关键字降级]
    Keyword --> Schema

    Schema --> Regex[正则解析<br/>&lt;a&gt; 标签]
    Regex --> |失败 tag| Repair{LLM ②<br/>修复兜底}
    Regex --> |成功| Merge[合并结果]
    Repair --> Merge

    Merge --> Write[写 data.json<br/>写 parsed-links-output.js]

    Write --> Query[用户提问]
    Query -->|LLM ③| Agent[Agent 调 query_data_json<br/>/ fetch_preview_qr]
    Agent --> Answer([自然语言答复])

    style Schema fill:#eef2ff
    style Repair fill:#eef2ff
    style Agent  fill:#eef2ff
```

---

## 图 4：ASCII 版（公众号排版备用）

```
┌────────────────┐
│  Excel 文件     │
└────┬───────────┘
     ▼
[xlsx 读表]
     │
     ▼
┌──────────────────────────────┐
│ LLM ①：识别"工具链接"列       │
│   失败 → 关键字同义词匹配     │
└────┬─────────────────────────┘
     ▼
[正则解析 <a> 标签]
     │  ┌─── 成功 ──────────────────┐
     │  │                           │
     │  └─── 失败 ──→ LLM ② 修复    │
     │                              │
     ▼                              │
[合并 parsedLinks + repairedLinks]◄─┘
     │
     ▼
[写 data.json / parsed-links-output.js]
     │
     ▼
用户对话  ◄── LLM ③：Agent + 3 个 Tool
            query_data_json
            fetch_preview_qr
            parse_excel_to_json
```

---

## 截图占位（发布前需替换）

| 位置 | 内容 | 工具推荐 |
|---|---|---|
| 封面 GIF | 手动 12 步 vs 对话 1 句话 | LICEcap / Kap |
| 首图 | UI 全景（浅色 Swiss 风格） | macOS 自带截图 (Cmd+Shift+4) |
| 聊天截图 | 气泡 + 工具 chip 展开 | Polish.dev / CleanShot |
| 代码截图 | 每段 10 行以内 | carbon.now.sh |
| 终端截图 | `curl /api/agent` 输出 | iTerm2 + Cmd+Shift+C |
