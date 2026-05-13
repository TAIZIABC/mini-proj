const XLSX = require('xlsx');
const fs = require('fs');
const { mapHeadersToSchema, repairFailedAnchorTags } = require('./llm');

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

/**
 * 解析整段 HTML，把所有 <a> 标签解析成对象数组。
 * - 返回 { parsedLinks, failedTags }，便于上层做 LLM 兜底修复
 *
 * @param {string} html
 * @returns {{ parsedLinks: Array<object>, failedTags: Array<{index:number, tag:string, raw:string, reason:string}> }}
 */
function parseLink(html) {
  const anchorTags = extractAnchorTags(html);
  console.warn(`📋 找到 ${anchorTags.length} 个 <a> 标签`);

  const parsedLinks = [];
  const failedTags = [];

  anchorTags.forEach((tag, index) => {
    try {
      const result = parseAnchorTag(tag);
      if (result) {
        parsedLinks.push(result);
      } else {
        failedTags.push({
          index: index + 1,
          tag: tag.substring(0, 200),
          raw: tag,
          reason: '无法提取名称或属性',
        });
      }
    } catch (err) {
      failedTags.push({
        index: index + 1,
        tag: tag.substring(0, 200),
        raw: tag,
        reason: err.message,
      });
    }
  });

  return { parsedLinks, failedTags };
}

/**
 * 把对象数组写入 OUTPUT_FILE_PATH（保持原有 PRESET_LINKS 命名）
 * @param {Array<object>} links
 */
function writePresetLinksFile(links) {
  const formatted = formatAsDataJs(links);
  const outputContent = `// 解析时间：${new Date().toLocaleString('zh-CN')}\n// 共 ${
    links.length
  } 条链接\n\nconst PRESET_LINKS = [\n${formatted},\n];\n\nmodule.exports = {\n  PRESET_LINKS,\n};\n`;
  fs.writeFileSync(OUTPUT_FILE_PATH, outputContent, 'utf-8');
  console.warn(`✅ 解析结果已保存到：${OUTPUT_FILE_PATH}`);
}

/**
 * 打印解析统计
 */
function logStats(parsedLinks, failedTags) {
  const typeCount = {};
  parsedLinks.forEach((link) => {
    typeCount[link.type] = (typeCount[link.type] || 0) + 1;
  });
  console.warn('📊 解析统计：');
  console.warn(`   总计解析成功：${parsedLinks.length} 条`);
  console.warn(`   解析失败：${failedTags.length} 条`);
  console.warn('   按类型分布：');
  Object.entries(typeCount)
    .sort((a, b) => b[1] - a[1])
    .forEach(([type, count]) => {
      console.warn(`     - ${type}: ${count} 条`);
    });
}



/* -------------------------------------------------------------------------- */
/*  parseExcel：                                                                */
/*    1) LLM 把表头映射成 schema（link/name/type/appid/path/formid 等）         */
/*    2) link 列拼成大 HTML 交给 parseLink 正则解析                             */
/*    3) 解析失败的 tag → LLM 兜底修复                                          */
/*    4) 用 schema 中 name/type/appid/path/formid 列补全/校正                   */
/*    5) 写盘 + 返回扁平数组                                                    */
/* -------------------------------------------------------------------------- */

/**
 * @param {Buffer} buffer Excel 文件 Buffer
 * @returns {Promise<Array<object>>}
 */
async function parseExcel(buffer) {
  // 1) 读 Excel
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error('Excel 中没有任何 Sheet');

  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: '',
    raw: false,
    blankrows: false,
  });
  if (!rows.length) throw new Error('Excel 内容为空');

  const headers = rows[0].map((h) => String(h ?? '').trim());
  const dataRows = rows.slice(1);

  // 2) LLM schema 映射
  const schema = await mapHeadersToSchema(headers);
  if (schema.link < 0) {
    throw new Error(`未能识别"工具链接"列。表头: [${headers.join(', ')}]`);
  }
  console.warn('🤖 表头 schema 映射：', JSON.stringify(schema));
  console.warn(`   link 列 → 第 ${schema.link + 1} 列「${headers[schema.link]}」`);

  // 3) 拼接 link 列所有 HTML 交给 parseLink
  const htmlChunks = dataRows
    .map((row) => String(row[schema.link] ?? '').trim())
    .filter((s) => s.length > 0);
  if (htmlChunks.length === 0) {
    throw new Error(`列「${headers[schema.link]}」中没有任何内容`);
  }
  const mergedHtml = htmlChunks.join('\n');

  const { parsedLinks, failedTags } = parseLink(mergedHtml);

  // 4) LLM 兜底修复失败 tag
  let repairedLinks = [];
  if (failedTags.length > 0) {
    console.warn(`🛠  正则失败 ${failedTags.length} 条，尝试用 LLM 修复…`);
    repairedLinks = await repairFailedAnchorTags(failedTags);
    if (repairedLinks.length > 0) {
      console.warn(`   LLM 成功修复 ${repairedLinks.length} 条`);
    }
  }

  let allLinks = [...parsedLinks, ...repairedLinks];


  // 6) 落盘 + 打日志
  logStats(allLinks, failedTags.filter((_, i) => !repairedLinks[i]));
  writePresetLinksFile(allLinks);

  return allLinks;
}

module.exports = { parseLink, parseExcel, writePresetLinksFile };
