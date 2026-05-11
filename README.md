# Excel-Agent

一个基于 **Node.js + LangChain.js + DeepSeek** 的 Agent，提供：

1. Web 上传页面 → 上传 Excel
2. 按规则解析 Excel（第一行表头，每行一条记录）→ 保存为 `public/data.json`
3. 对外暴露 `data.json` 的 HTTP 访问地址
4. 调用本地小程序预览码接口，返回预览码图片

## 目录结构

```
mini-proj/
├── public/
│   ├── index.html          # 前端上传页面
│   └── data.json           # 解析结果（运行后生成，对外可访问）
├── src/
│   ├── server.js           # Express 服务入口
│   ├── agent.js            # LangChain.js Agent + Tools
│   └── excelParser.js      # Excel → JSON 解析规则
├── uploads/                # 上传的原始 Excel（运行时生成）
├── package.json
└── .env.example
```

## 安装

```bash
cd /Users/kingjungle/Documents/work/mini-proj
npm install
```

## 配置

复制 `.env.example` 为 `.env`，填入 DeepSeek API Key：

```bash
cp .env.example .env
# 然后编辑 .env，填入 DEEPSEEK_API_KEY
```

> 仅在使用 `/api/agent` 自然语言入口时需要 LLM。前端页面的「上传 + 预览码」流程**不依赖 LLM**，可直接使用。

## 启动

```bash
npm start
```

启动后：

- Web 页面：<http://127.0.0.1:3000/>
- data.json 对外地址：<http://127.0.0.1:3000/data.json>
- 预览码 API：`GET /api/preview`
- 上传 API：`POST /api/upload`（multipart/form-data，字段名 `file`）
- Agent 自然语言入口：`POST /api/agent` body `{ "message": "..." }`

## 解析规则

- Excel 第一行作为表头（key），后续每一行为一个对象
- 单 Sheet → 输出对象数组；多 Sheet → 输出 `{ sheetName: [...] }`
- 自动跳过完全空行，自动 trim 字符串单元格

## 预览码接口

服务会调用 `.env` 中 `PREVIEW_API` 配置的接口（默认指向 `AppletNew` 项目）：

```
GET http://127.0.0.1:30747/v2/preview?project=%2FUsers%2Fkingjungle%2FDocuments%2Fwork%2FAppletNew
```

- 若返回 `image/*`，会自动转成 base64 data URL，前端直接展示二维码
- 若返回 JSON/文本，则原样返回供前端处理

## curl 示例

```bash
# 上传 Excel
curl -F "file=@/path/to/your.xlsx" http://127.0.0.1:3000/api/upload

# 获取预览码
curl http://127.0.0.1:3000/api/preview

# 让 Agent 自主完成（需要 DEEPSEEK_API_KEY）
curl -X POST http://127.0.0.1:3000/api/agent \
  -H "Content-Type: application/json" \
  -d '{"message":"请获取小程序预览码"}'
```
