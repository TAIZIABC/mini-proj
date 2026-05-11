const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');
const { ChatOpenAI } = require('@langchain/openai');

const OUTPUT_FILE_PATH = '/Users/kingjungle/Documents/work/AppletNew/pkgVideo/pages/test-url/parsed-links-output.js';



/**
 * 提取标签中的属性值
 * @param {string} tag - HTML 标签字符串
 * @param {string} attr - 属性名
 * @returns {string|null} 属性值
 */
function getAttr(tag, attr) {
  // 匹配 attr="value"、attr='value' 和 attr=value 三种格式
  const patterns = [
    new RegExp(`${attr}\\s*=\\s*"([^"]*)"`, 'i'),
    new RegExp(`${attr}\\s*=\\s*'([^']*)'`, 'i'),
    new RegExp(`${attr}\\s*=\\s*([^\\s>'"]+)`, 'i'),
  ];

  for (const pattern of patterns) {
    const match = tag.match(pattern);
    if (match) return match[1].trim();
  }
  return null;
}

/**
 * 提取标签的文本内容（去除嵌套标签）
 * @param {string} fullTag - 完整的 <a>...</a> 字符串
 * @returns {string} 纯文本内容
 */
function getTextContent(fullTag) {
  // 移除所有 HTML 标签
  let text = fullTag.replace(/<[^>]+>/g, '');
  // 清理空白字符
  text = text.replace(/\s+/g, ' ').trim();
  // 解码常见 HTML 实体
  text = text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, '\'')
    .replace(/&nbsp;/g, ' ');
  return text;
}

/**
 * 判断链接类型
 * @param {object} attrs - 解析出的属性对象
 * @returns {string} 链接类型
 */
function detectType(attrs) {
  const { href, appid, mpPath, typeAttr, formid } = attrs;

  // 显式指定了 type 属性
  if (typeAttr) {
    const t = typeAttr.toLowerCase();
    if (t === 'form') return 'form';
    if (t === 'tool') return 'tool';
    if (t === 'h5') return 'h5';
    if (t === 'smallprogram' || t === 'miniprogram') return 'smallProgram';
    if (t === 'scheme') return 'scheme';
    if (t === 'tel') return 'tel';
    return t;
  }

  // 有小程序 appid 和 path
  if (appid && mpPath) return 'smallProgram';

  // 有 formid
  if (formid) return 'form';

  // 电话链接
  if (href && href.startsWith('tel:')) return 'tel';

  // weixin scheme
  if (href && (href.startsWith('weixin://') || href.startsWith('wxpay://'))) return 'scheme';

  // 默认 h5
  return 'h5';
}

/**
 * 解析单个 <a> 标签
 * @param {string} fullTag - 完整的 <a>...</a> 标签
 * @returns {object|null} 解析后的配置对象
 */
function parseAnchorTag(fullTag) {
  const name = getTextContent(fullTag);
  if (!name) return null;

  // 提取开始标签部分
  const openTagMatch = fullTag.match(/<a\s[^>]*>/i);
  if (!openTagMatch) return null;
  const openTag = openTagMatch[0];

  const href = getAttr(openTag, 'href');
  const appid = getAttr(openTag, 'data-miniprogram-appid');
  const mpPath = getAttr(openTag, 'data-miniprogram-path');
  const typeAttr = getAttr(openTag, 'type');
  const formid = getAttr(openTag, 'formid');

  const type = detectType({ href, appid, mpPath, typeAttr, formid });

  // 构建结果对象
  const result = { name };

  if (href) result.href = href;
  if (appid) result.appid = appid;
  if (mpPath) result.path = mpPath;
  if (formid) result.formid = formid;

  result.type = type;

  return result;
}

/**
 * 从 HTML 字符串中提取所有 <a> 标签（支持嵌套标签和多行）
 * @param {string} html - HTML 字符串
 * @returns {string[]} <a>...</a> 标签数组
 */
function extractAnchorTags(html) {
  const tags = [];
  // 匹配 <a ... > ... </a>，支持多行和嵌套标签
  const regex = /<a\s[^>]*>[\s\S]*?<\/a>/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    tags.push(match[0]);
  }
  return tags;
}

/**
 * 将对象数组格式化为 data.js 风格的字符串
 * @param {object[]} links - 解析后的链接数组
 * @returns {string} 格式化后的字符串
 */
function formatAsDataJs(links) {
  const lines = links.map((link) => {
    const props = [];

    // 按固定顺序排列属性：name, href, appid, path, formid, type
    if (link.name !== undefined) props.push(`    name: '${escapeStr(link.name)}'`);
    if (link.href !== undefined) props.push(`    href: '${escapeStr(link.href)}'`);
    if (link.appid !== undefined) props.push(`    appid: '${escapeStr(link.appid)}'`);
    if (link.path !== undefined) props.push(`    path: '${escapeStr(link.path)}'`);
    if (link.formid !== undefined) props.push(`    formid: '${escapeStr(link.formid)}'`);
    if (link.type !== undefined) props.push(`    type: '${escapeStr(link.type)}'`);

    return `  {\n${props.join(',\n')},\n  }`;
  });

  return lines.join(',\n');
}

/**
 * 转义字符串中的单引号
 * @param {string} str
 * @returns {string}
 */
function escapeStr(str) {
  return str.replace(/\\/g, '\\\\').replace(/'/g, '\\\'');
}

function parseLink(html) {

// 提取所有 <a> 标签
  const anchorTags = extractAnchorTags(html);
  console.warn(`📋 找到 ${anchorTags.length} 个 <a> 标签\n`);

  if (anchorTags.length === 0) {
    console.warn('⚠️  未找到任何 <a> 标签。');
    console.warn('   请将 HTML 内容粘贴到脚本中的 htmlContent 变量，');
    console.warn('   或通过命令行参数指定 HTML 文件：');
    console.warn('   node parse-links.js ./input.html\n');
    return;
  }

// 逐个解析
  const parsedLinks = [];
  const errors = [];

  anchorTags.forEach((tag, index) => {
    try {
      const result = parseAnchorTag(tag);
      if (result) {
        parsedLinks.push(result);
      } else {
        errors.push({ index: index + 1, tag: tag.substring(0, 100), reason: '无法提取名称或属性' });
      }
    } catch (err) {
      errors.push({ index: index + 1, tag: tag.substring(0, 100), reason: err.message });
    }
  });

  // 统计信息
  const typeCount = {};
  parsedLinks.forEach((link) => {
    typeCount[link.type] = (typeCount[link.type] || 0) + 1;
  });

  console.warn('📊 解析统计：');
  console.warn(`   总计解析成功：${parsedLinks.length} 条`);
  console.warn(`   解析失败：${errors.length} 条`);
  console.warn('   按类型分布：');
  Object.entries(typeCount)
    .sort((a, b) => b[1] - a[1])
    .forEach(([type, count]) => {
      console.warn(`     - ${type}: ${count} 条`);
    });
  console.warn('');

  // 打印失败的标签
  if (errors.length > 0) {
    console.warn('⚠️  解析失败的标签：');
    errors.forEach((err) => {
      console.warn(`   #${err.index}: ${err.reason}`);
      console.warn(`     ${err.tag}...`);
    });
    console.warn('');
  }

  // 格式化输出
  const formatted = formatAsDataJs(parsedLinks);
  
  // 保存到输出文件
  const outputContent = `// 解析时间：${new Date().toLocaleString('zh-CN')}\n// 共 ${
    parsedLinks.length
  } 条链接\n\nconst PRESET_LINKS = [\n${formatted},\n];\n\nmodule.exports = {\n  PRESET_LINKS,\n};\n`;
  fs.writeFileSync(OUTPUT_FILE_PATH, outputContent, 'utf-8');
  console.warn(`✅ 解析结果已保存到：${OUTPUT_FILE_PATH}`);
}


module.exports = { parseLink, parseExcel };

/* -------------------------------------------------------------------------- */
/*  parseExcel：借助大模型识别"工具链接"列，然后交给 parseLink 处理            */
/* -------------------------------------------------------------------------- */

/**
 * 借助 LLM 从 Excel 表头中识别"工具链接"列；
 * 然后把该列所有单元格的 HTML 拼接，一次性交给 parseLink；
 * parseLink 会把解析结果写入 parsed-links-output.js，
 * parseExcel 读取该文件并把 PRESET_LINKS 作为扁平数组返回。
 *
 * @param {Buffer} buffer Excel 文件 Buffer
 * @returns {Promise<Array<object>>} 解析出的链接对象数组
 */
async function parseExcel(buffer) {
  // 1) 读 Excel，取第一个 Sheet 的二维数组
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error('Excel 中没有任何 Sheet');

  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: '',
    raw: false, // 让富文本/超链接也能转成字符串
    blankrows: false,
  });
  if (!rows.length) throw new Error('Excel 内容为空');

  const headers = rows[0].map((h) => String(h ?? '').trim());
  const dataRows = rows.slice(1);

  // 2) 让 LLM 在表头里识别"工具链接"列的索引
  const toolLinkIdx = await detectToolLinkColumn(headers);
  if (toolLinkIdx < 0 || toolLinkIdx >= headers.length) {
    throw new Error(`未能在表头中识别出"工具链接"列。表头: [${headers.join(', ')}]`);
  }
  console.warn(`🤖 LLM 识别"工具链接"列为：第 ${toolLinkIdx + 1} 列「${headers[toolLinkIdx]}」`);

  // 3) 收集该列所有非空单元格 HTML，拼接成一个大 HTML 串
  const htmlChunks = dataRows
    .map((row) => String(row[toolLinkIdx] ?? '').trim())
    .filter((s) => s.length > 0);

  if (htmlChunks.length === 0) {
    throw new Error(`列「${headers[toolLinkIdx]}」中没有任何内容`);
  }
  const mergedHtml = htmlChunks.join('\n');

  // 4) 交给 parseLink（它会写文件、不返回值）
  parseLink(mergedHtml);

  // 5) 读回 parseLink 写出的文件，require 时清缓存避免拿到旧结果
  delete require.cache[require.resolve(OUTPUT_FILE_PATH)];
  // eslint-disable-next-line import/no-dynamic-require, global-require
  const { PRESET_LINKS } = require(OUTPUT_FILE_PATH);
  return Array.isArray(PRESET_LINKS) ? PRESET_LINKS : [];
}

/**
 * 让 LLM 从表头数组中识别"工具链接"列的索引（0-based）。
 * 容错同义词：工具链接 / 工具地址 / 链接 / 跳转链接 / Link / URL 等。
 * 失败时降级为代码模糊匹配。
 *
 * @param {string[]} headers
 * @returns {Promise<number>}
 */
async function detectToolLinkColumn(headers) {
  // 先尝试 LLM
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (apiKey) {
    try {
      const llm = new ChatOpenAI({
        apiKey,
        model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
        temperature: 0,
        configuration: {
          baseURL: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1',
        },
      });

      const prompt = `你是一个表格列名识别助手。下面是一张 Excel 表的表头数组（按列顺序）：
${JSON.stringify(headers)}

请从中找出"工具链接"列的索引（0-based）。该列通常包含 <a> 标签或 URL，列名同义词包括但不限于：工具链接、工具地址、链接、跳转链接、Link、URL、地址、href。

只允许返回一个 JSON 对象，格式严格如下，不要任何额外文字、解释或代码块标记：
{"index": <数字>, "header": "<对应列名>"}

如果完全无法识别，返回 {"index": -1, "header": ""}。`;

      const resp = await llm.invoke(prompt);
      const text = typeof resp.content === 'string'
        ? resp.content
        : Array.isArray(resp.content)
          ? resp.content.map((c) => (typeof c === 'string' ? c : c.text || '')).join('')
          : '';

      // 抠出 JSON
      const match = text.match(/\{[\s\S]*?\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        if (Number.isInteger(parsed.index) && parsed.index >= 0) {
          return parsed.index;
        }
      }
    } catch (err) {
      console.warn('⚠️  LLM 识别工具链接列失败，降级为关键字匹配：', err.message);
    }
  } else {
    console.warn('⚠️  未配置 DEEPSEEK_API_KEY，使用关键字匹配识别工具链接列');
  }

  // 降级：关键字模糊匹配
  const keywords = ['工具链接', '工具地址', '跳转链接', '链接', 'link', 'url', '地址', 'href'];
  const lowered = headers.map((h) => h.toLowerCase());
  for (const kw of keywords) {
    const idx = lowered.findIndex((h) => h.includes(kw.toLowerCase()));
    if (idx >= 0) return idx;
  }
  return -1;
}
