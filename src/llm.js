/**
 * LLM 公共能力：
 *   - getLLM()                   返回 ChatOpenAI 实例（DeepSeek 兼容协议）
 *   - mapHeadersToSchema(...)    把 Excel 表头映射到统一 schema 字段
 *   - repairFailedAnchorTags(...) 用 LLM 修复正则解析失败的 <a> 标签
 *
 * 设计原则：
 *   1. 所有 LLM 调用都加 try/catch + 关键字/规则降级，余额不足/网络异常不影响主流程
 *   2. 返回值结构稳定（要么数据，要么明确的失败值），上层不需要再做防御
 */

const { ChatOpenAI } = require('@langchain/openai');

let _llm = null;
function getLLM() {
  if (_llm) return _llm;
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return null;
  _llm = new ChatOpenAI({
    apiKey,
    model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
    temperature: 0,
    configuration: {
      baseURL: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1',
    },
  });
  return _llm;
}

/** 从 LLM 响应里抠出 JSON 对象（兼容 ```json ... ``` 包裹） */
function extractJson(text) {
  if (!text) return null;
  // 优先匹配代码块
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : text).trim();
  // 找第一个 { 和最后一个 }
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

function llmContentToText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((c) => (typeof c === 'string' ? c : c.text || '')).join('');
  }
  return '';
}

/* -------------------------------------------------------------------------- */
/*  #1 表头 → schema 多字段映射                                                */
/* -------------------------------------------------------------------------- */

/**
 * 我们关心的字段及其同义词（用于关键字降级）。
 * 字段含义：
 *   link   - 工具链接列（必需）
 *   name   - 工具名称
 *   type   - 跳转类型（h5/smallProgram/tool/form/scheme/tel）
 *   appid  - 小程序 appid
 *   path   - 小程序路径
 *   formid - 表单 ID
 */
const FIELD_SYNONYMS = {
  link: ['工具链接', '工具地址', '跳转链接', '链接', 'link', 'url', '地址', 'href'],
  name: ['工具名称', '工具名', '名称', '名字', 'name', 'title', '标题'],
  type: ['类型', '跳转类型', 'type', '链接类型'],
  appid: ['小程序appid', '小程序 appid', 'appid', 'app id', 'app_id'],
  path: ['小程序路径', '路径', 'path', '页面路径', '小程序页面'],
  formid: ['表单id', 'formid', 'form id', 'form_id', '表单 id'],
};

/**
 * 用 LLM 把 Excel 表头数组映射到 schema：
 *   返回 { link, name, type, appid, path, formid } 每个字段值是列索引（0-based），不存在则 -1
 *
 * @param {string[]} headers
 * @returns {Promise<{link:number,name:number,type:number,appid:number,path:number,formid:number}>}
 */
async function mapHeadersToSchema(headers) {
  const empty = { link: -1, name: -1, type: -1, appid: -1, path: -1, formid: -1 };
  const llm = getLLM();

  if (llm) {
    try {
      const prompt = `你是一个表格列名识别助手。给定一张 Excel 表的表头数组（按列顺序）：
${JSON.stringify(headers)}

请把它们映射到下面的标准字段（schema），每个字段返回对应列的 0-based 索引；如果完全找不到对应列，返回 -1。

字段说明：
- link   ：工具链接列，常见列名：工具链接、链接、跳转链接、URL、地址、href
- name   ：工具名称列，常见列名：工具名称、名称、name、title
- type   ：跳转类型列，常见列名：类型、跳转类型、type
- appid  ：小程序 appid 列
- path   ：小程序路径列
- formid ：表单 ID 列

严格只返回一个 JSON 对象，不要任何额外文字或代码块包裹，格式：
{"link": <数字>, "name": <数字>, "type": <数字>, "appid": <数字>, "path": <数字>, "formid": <数字>}`;

      const resp = await llm.invoke(prompt);
      const json = extractJson(llmContentToText(resp.content));
      if (json) {
        const out = { ...empty };
        for (const k of Object.keys(out)) {
          if (Number.isInteger(json[k]) && json[k] >= 0 && json[k] < headers.length) {
            out[k] = json[k];
          }
        }
        // 至少识别出 link 才认为 LLM 有效，否则走降级
        if (out.link >= 0) return out;
      }
    } catch (err) {
      console.warn('⚠️  LLM 表头 schema 映射失败，降级为关键字匹配：', err.message);
    }
  } else {
    console.warn('⚠️  未配置 DEEPSEEK_API_KEY，使用关键字匹配进行表头 schema 映射');
  }

  // 关键字降级
  const lowered = headers.map((h) => String(h ?? '').toLowerCase());
  const out = { ...empty };
  for (const [field, kws] of Object.entries(FIELD_SYNONYMS)) {
    for (const kw of kws) {
      const idx = lowered.findIndex((h) => h.includes(kw.toLowerCase()));
      if (idx >= 0) { out[field] = idx; break; }
    }
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/*  #2 解析失败的 <a> 标签 LLM 兜底修复                                         */
/* -------------------------------------------------------------------------- */

/**
 * 把正则解析失败的 <a> 标签喂给 LLM，让其输出标准化对象数组。
 * 失败/无 LLM 时返回空数组（外层会原样保留 errors）。
 *
 * @param {Array<{index:number, tag:string, reason:string, raw?:string}>} failedTags
 * @returns {Promise<Array<object>>} 修复成功的对象数组（schema 与 parseAnchorTag 输出一致）
 */
async function repairFailedAnchorTags(failedTags) {
  if (!failedTags || failedTags.length === 0) return [];
  const llm = getLLM();
  if (!llm) return [];

  // 控制单次请求体积：每批最多 20 条
  const BATCH = 20;
  const repaired = [];

  for (let i = 0; i < failedTags.length; i += BATCH) {
    const batch = failedTags.slice(i, i + BATCH);
    const prompt = `下面是若干"正则解析失败"的 HTML 片段（可能是 <a> 标签或自定义标签）。
请尽你所能把每一条解析为一个对象，输出一个 JSON 数组，长度与输入一致；解析不出来的位置请输出 null（保持索引对齐）。

对象字段：
- name   字符串，链接文本（必填）
- type   字符串，从这些值中选：h5 / smallProgram / tool / form / scheme / tel
- href   字符串，URL（h5/scheme/tel/tool 必填）
- appid  字符串，小程序 appid（type=smallProgram 必填）
- path   字符串，小程序路径（type=smallProgram 时可选）
- formid 字符串，表单 ID（type=form 时必填）

输入：
${JSON.stringify(batch.map((t) => t.raw || t.tag))}

严格只返回一个 JSON 数组，不要任何额外文字或代码块包裹。`;

    try {
      const resp = await llm.invoke(prompt);
      const text = llmContentToText(resp.content);
      const match = text.match(/\[[\s\S]*\]/);
      if (!match) continue;
      const arr = JSON.parse(match[0]);
      if (!Array.isArray(arr)) continue;
      arr.forEach((obj) => {
        if (obj && typeof obj === 'object' && obj.name && obj.type) {
          repaired.push(obj);
        }
      });
    } catch (err) {
      console.warn('⚠️  LLM 修复失败 tag 时报错（已跳过该批）：', err.message);
    }
  }

  return repaired;
}

module.exports = {
  getLLM,
  mapHeadersToSchema,
  repairFailedAnchorTags,
  FIELD_SYNONYMS,
};
