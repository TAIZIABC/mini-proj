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
    tools: [parseExcelTool, fetchPreviewTool],
    systemPrompt:
      '你是一个文件处理 Agent，可以使用工具解析 Excel 为 JSON，或获取小程序预览码。回答简洁中文。',
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
  const last = result.messages[result.messages.length - 1];
  return { content: last?.content ?? '', messages: result.messages };
}

module.exports = {
  runParseExcel,
  runFetchPreview,
  runAgent,
  DATA_JSON_PATH,
};
