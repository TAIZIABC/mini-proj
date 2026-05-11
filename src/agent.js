const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { z } = require('zod');
const { tool } = require('@langchain/core/tools');
const { ChatOpenAI } = require('@langchain/openai');
const { createAgent } = require('langchain');
const { parseExcel } = require('./excelParser');

const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');
const DATA_JSON_PATH = path.join(PUBLIC_DIR, 'data.json');
const TEMP_DIR = path.resolve(__dirname, '..', 'temp');

if (!fs.existsSync(PUBLIC_DIR)) fs.mkdirSync(PUBLIC_DIR, { recursive: true });
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

/* -------------------------------------------------------------------------- */
/*  Tools                                                                     */
/* -------------------------------------------------------------------------- */

/** Tool 1: 解析 Excel 并保存为 data.json */
const parseExcelTool = tool(
  async ({ filePath }) => {
    if (!fs.existsSync(filePath)) {
      return JSON.stringify({ ok: false, error: `文件不存在: ${filePath}` });
    }
    const buffer = fs.readFileSync(filePath);
    const json = await parseExcel(buffer);
    fs.writeFileSync(DATA_JSON_PATH, JSON.stringify(json, null, 2), 'utf8');
    const count = Array.isArray(json)
      ? json.length
      : Object.values(json).reduce((s, arr) => s + (Array.isArray(arr) ? arr.length : 0), 0);
    return JSON.stringify({
      ok: true,
      savedTo: DATA_JSON_PATH,
      publicUrl: '/data.json',
      recordCount: count,
      preview: Array.isArray(json) ? json.slice(0, 3) : json,
    });
  },
  {
    name: 'parse_excel_to_json',
    description:
      '将给定路径的 Excel 文件解析成符合规则（第一行为表头、后续每行一个对象）的 JSON，并保存到 public/data.json。返回保存路径与对外访问 URL。',
    schema: z.object({
      filePath: z.string().describe('待解析的 Excel 文件在服务器上的绝对路径'),
    }),
  }
);

/** Tool 2: 调用小程序预览码接口 */
const fetchPreviewTool = tool(
  async () => {
    const url =
      process.env.PREVIEW_API ||
      'http://127.0.0.1:30747/v2/preview?project=%2FUsers%2Fkingjungle%2FDocuments%2Fwork%2FAppletNew';
    try {
      const resp = await axios.get(url, { timeout: 60_000, responseType: 'arraybuffer' });
      const contentType = resp.headers['content-type'] || 'image/png';
      const fileName = `preview_${Date.now()}.png`;
      const absPath = path.join(TEMP_DIR, fileName);
      fs.writeFileSync(absPath, Buffer.from(resp.data));
      return JSON.stringify({
        ok: true,
        type: 'image',
        contentType,
        fileName,
        publicUrl: `/temp/${fileName}`,
      });
    } catch (err) {
      console.error('fetchPreviewTool error', err);
      return JSON.stringify({
        ok: false,
        error: `调用预览码接口失败: ${err.message}`,
      });
    }
  },
  {
    name: 'fetch_preview_qr',
    description:
      '调用本地小程序预览码接口（GET http://127.0.0.1:30747/v2/preview?project=...），返回小程序预览二维码。',
    schema: z.object({}),
  }
);

/** Tool 3: 查询当前 data.json 的内容/统计 */
const queryDataJsonTool = tool(
  async ({ filterType, limit }) => {
    if (!fs.existsSync(DATA_JSON_PATH)) {
      return JSON.stringify({ ok: false, error: '尚未生成 data.json，请先上传 Excel 解析' });
    }
    let data;
    try {
      data = JSON.parse(fs.readFileSync(DATA_JSON_PATH, 'utf8'));
    } catch (e) {
      return JSON.stringify({ ok: false, error: 'data.json 解析失败：' + e.message });
    }
    const arr = Array.isArray(data) ? data : Object.values(data).flat();

    const typeCount = {};
    arr.forEach((it) => {
      const t = it && it.type ? String(it.type) : 'unknown';
      typeCount[t] = (typeCount[t] || 0) + 1;
    });

    let filtered = arr;
    if (filterType) {
      filtered = arr.filter((it) => it && String(it.type) === String(filterType));
    }
    const max = Math.max(1, Math.min(50, Number(limit) || 10));

    return JSON.stringify({
      ok: true,
      total: arr.length,
      typeCount,
      filteredCount: filtered.length,
      sample: filtered.slice(0, max),
    });
  },
  {
    name: 'query_data_json',
    description:
      '查询已经解析生成的 data.json 内容：返回总条数、按 type 分布的统计，以及可选按 type 过滤后的样本。',
    schema: z.object({
      filterType: z
        .string()
        .optional()
        .describe('可选：按 type 字段过滤（如 h5 / smallProgram / tool / form / scheme / tel）'),
      limit: z
        .number()
        .optional()
        .describe('返回样本最大条数，默认 10，最大 50'),
    }),
  }
);

/* -------------------------------------------------------------------------- */
/*  Agent                                                                     */
/* -------------------------------------------------------------------------- */

let _agent = null;
function getAgent() {
  if (_agent) return _agent;

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error('未配置 DEEPSEEK_API_KEY，请在 .env 中配置后重启服务');
  }

  const llm = new ChatOpenAI({
    apiKey,
    model: process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash',
    temperature: 0,
    configuration: {
      baseURL: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1',
    },
  });

  _agent = createAgent({
    model: llm,
    tools: [parseExcelTool, fetchPreviewTool, queryDataJsonTool],
    systemPrompt:
      '你是一个文件处理助手，可使用工具：\n' +
      '1) parse_excel_to_json —— 当用户提供 Excel 文件路径时调用，把表格解析为 data.json\n' +
      '2) fetch_preview_qr   —— 获取小程序预览二维码（无需参数）\n' +
      '3) query_data_json    —— 查询已解析的 data.json 总条数 / 按 type 分布 / 样本\n' +
      '回答简洁中文，必要时主动调用工具，不要假设结果。如果需要的信息缺失，先告知用户。',
  });
  return _agent;
}

/**
 * 直接使用工具的"裸调用"路径（不经 LLM），保证 UI 流程稳定可用。
 */
async function runParseExcel(filePath) {
  const raw = await parseExcelTool.invoke({ filePath });
  return JSON.parse(raw);
}

async function runFetchPreview() {
    console.log('runFetchPreview')
  const raw = await fetchPreviewTool.invoke({});
  return JSON.parse(raw);
}

/**
 * 让 LLM Agent 自主推理（可选，用于"自然语言驱动"场景）。
 * @param {string} userMessage
 */
async function runAgent(userMessage) {
  const agent = getAgent();
  const result = await agent.invoke({
    messages: [{ role: 'user', content: userMessage }],
  });

  // 提取工具调用摘要 + 对应工具结果，便于前端展示"Agent 都做了什么 / 结果是什么"
  // - LangChain 会把每个工具返回生成一条 ToolMessage（type === 'tool' 或 role === 'tool'），
  //   其 tool_call_id 对应发起调用的 assistant message 里的 tool_calls[].id
  const toolResultById = {};
  for (const m of result.messages || []) {
    const type = m?._getType?.() || m?.type || m?.role;
    const id = m?.tool_call_id || m?.additional_kwargs?.tool_call_id;
    if ((type === 'tool' || type === 'ToolMessage') && id) {
      let out = m?.content;
      if (typeof out === 'string') {
        try { out = JSON.parse(out); } catch { /* 保留字符串 */ }
      }
      toolResultById[id] = out;
    }
  }

  const toolCalls = [];
  for (const m of result.messages || []) {
    const calls = m?.tool_calls || m?.additional_kwargs?.tool_calls;
    if (Array.isArray(calls) && calls.length > 0) {
      calls.forEach((c) => {
        const id = c.id || c.tool_call_id;
        let args = c.args ?? c.function?.arguments;
        if (typeof args === 'string') {
          try { args = JSON.parse(args); } catch { /* 保留字符串 */ }
        }
        toolCalls.push({
          id,
          name: c.name || c.function?.name,
          args,
          result: id ? toolResultById[id] : undefined,
        });
      });
    }
  }

  const last = result.messages[result.messages.length - 1];
  return {
    content: last?.content ?? '',
    toolCalls,
    messageCount: result.messages?.length ?? 0,
  };
}

module.exports = {
  runParseExcel,
  runFetchPreview,
  runAgent,
  DATA_JSON_PATH,
};
