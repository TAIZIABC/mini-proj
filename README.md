# Excel-Agent

一个基于 **Node.js + LangChain.js + DeepSeek** 的 Agent，提供：

1. Web 上传页面 → 上传 Excel（含 `<a>` 标签的工具链接表）
2. **LLM 智能识别**列 schema → 解析所有 `<a>` 标签 → 生成 `PRESET_LINKS` 写入小程序源码目录
3. 对外暴露解析结果 `data.json` 的 HTTP 访问地址
4. 调用本地小程序预览码接口，返回二维码图片
5. **自然语言入口**：通过聊天指挥 Agent 解析 / 取预览码 / 查 data.json

## 目录结构

```
mini-proj/
├── public/
│   ├── index.html        # 前端上传 + 预览 + 聊天入口
│   └── data.json         # 解析结果（运行时生成，对外可访问）
├── src/
│   ├── server.js         # Express 服务入口
│   ├── agent.js          # LangChain.js Agent + 三个 Tool
│   ├── excelParser.js    # Excel → JSON：含 parseLink/parseExcel
│   └── llm.js            # 公共 LLM 能力：getLLM/mapHeadersToSchema/repairFailedAnchorTags
├── temp/                 # 预览码图片落盘（运行时生成）
├── uploads/              # 上传的原始 Excel（运行时生成）
├── package.json
└── .env.example
```

## AI 能力（在哪些环节用到了 LLM）

| 环节 | 文件 | 是否依赖 LLM | 失败兜底 |
|---|---|---|---|
| 表头 → schema 映射（识别 link/name/type/appid/path/formid 列） | `src/llm.js#mapHeadersToSchema` | LLM 优先 | 关键字模糊匹配 |
| 链接 `<a>` 正则解析 | `src/excelParser.js#parseLink` | 否 | — |
| 正则解析失败的 tag → LLM 修复成标准对象 | `src/llm.js#repairFailedAnchorTags` | LLM | 失败则保留原 errors |
| 自然语言入口（前端聊天） | `src/agent.js#runAgent` + 三个 Tool | LLM | — |

> 没有配置 `DEEPSEEK_API_KEY` 时，**主流程依然可用**：表头识别走关键字、修复步骤跳过；只有「自然语言入口」需要 LLM。

## 安装

```bash
cd /Users/kingjungle/Documents/work/mini-proj
npm install
```

## 配置

复制 `.env.example` 为 `.env`，填入 DeepSeek API Key：

```bash
cp .env.example .env
# 编辑 .env：DEEPSEEK_API_KEY=sk-xxxxxxxx
```

可选环境变量：

| 变量 | 默认值 |
|---|---|
| `PORT` | `3000` |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com/v1` |
| `DEEPSEEK_MODEL` | `deepseek-chat` |
| `PREVIEW_API` | 指向本地 30747 的 AppletNew 预览接口 |

## 启动

```bash
npm start
```

启动后访问：

- Web 页面：<http://127.0.0.1:3000/>
- data.json 对外地址：<http://127.0.0.1:3000/data.json>
- 预览码图片：<http://127.0.0.1:3000/temp/preview_*.png>

## 接口列表

| 方法 | 路径 | 说明 |
|---|---|---|
| GET  | `/api/health` | 健康检查 |
| POST | `/api/upload` | 上传 Excel（multipart `file`），返回解析摘要 + data.json 地址 |
| GET  | `/api/preview` | 拉小程序预览码（落盘到 `/temp/preview_<ts>.png`） |
| POST | `/api/agent` | 自然语言入口，body `{ message: string }` |

## Agent 工具

| 工具名 | 作用 |
|---|---|
| `parse_excel_to_json` | 用 LLM schema 映射解析 Excel，把链接列写入 `data.json` |
| `fetch_preview_qr` | 调用本地预览码接口，返回二维码图片地址 |
| `query_data_json` | 查询 data.json 的总条数、type 分布、按 type 过滤后的样本 |

## 解析规则

1. 读第一个 Sheet
2. 用 LLM（或关键字降级）识别 `link / name / type / appid / path / formid` 列
3. 把 `link` 列所有非空单元格 HTML 拼接，正则提取 `<a>` 标签
4. 解析失败的 tag 进入 LLM 修复流水线
5. 用其他列对单条解析结果做字段补全（仅当该行恰好产生 1 条 link 时）
6. 写入：
   - `public/data.json` —— 对外可访问
   - `/Users/kingjungle/Documents/work/AppletNew/pkgVideo/pages/test-url/parsed-links-output.js` —— `PRESET_LINKS` 数组，供小程序直接 require

## curl 示例

```bash
# 上传 Excel
curl -F "file=@/path/to/your.xlsx" http://127.0.0.1:3000/api/upload

# 获取预览码
curl http://127.0.0.1:3000/api/preview

# 让 Agent 自主完成（需要 DEEPSEEK_API_KEY）
curl -X POST http://127.0.0.1:3000/api/agent \
  -H "Content-Type: application/json" \
  -d '{"message":"data.json 里 type 分布是怎样的？"}'
```

聊天入口能听懂的指令示例：
- "data.json 里有几条 type=h5 的？"
- "重新拉一次小程序预览码"
- "前 5 条 smallProgram 类型的链接"
