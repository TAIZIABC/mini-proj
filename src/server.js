require('dotenv').config();

const path = require('path');
const fs = require('fs');
const express = require('express');
const multer = require('multer');

const { runParseExcel, runFetchPreview, runAgent } = require('./agent');

const PORT = parseInt(process.env.PORT || '3000', 10);
const ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const UPLOAD_DIR = path.join(ROOT, 'uploads');
const TEMP_DIR = path.join(ROOT, 'temp');

for (const d of [PUBLIC_DIR, UPLOAD_DIR, TEMP_DIR]) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

const app = express();
app.use(express.json({ limit: '5mb' }));

// 静态资源：前端页面 + 对外暴露 data.json
app.use(express.static(PUBLIC_DIR));
// 对外暴露临时文件（如预览码图片）
app.use('/temp', express.static(TEMP_DIR));

// multer：保存上传的 Excel
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
      const ts = Date.now();
      const safe = file.originalname.replace(/[^\w.\-\u4e00-\u9fa5]/g, '_');
      cb(null, `${ts}_${safe}`);
    },
  }),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
  fileFilter: (req, file, cb) => {
    const ok = /\.(xlsx|xls|csv)$/i.test(file.originalname);
    cb(ok ? null : new Error('仅支持 .xlsx / .xls / .csv 文件'), ok);
  },
});

/* -------------------------------------------------------------------------- */
/*  Routes                                                                    */
/* -------------------------------------------------------------------------- */

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

/**
 * POST /api/upload
 * 上传 Excel，解析为 JSON 并保存到 public/data.json
 * 响应包含 data.json 的对外访问地址
 */
app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: '未收到文件' });
    const result = await runParseExcel(req.file.path);
    if (!result.ok) return res.status(400).json(result);

    const host = req.headers.host || `127.0.0.1:${PORT}`;
    const publicUrl = `${req.protocol}://${host}/data.json`;
    res.json({
      ok: true,
      message: 'Excel 已解析并保存',
      recordCount: result.recordCount,
      preview: result.preview,
      dataJsonUrl: publicUrl,
    });
  } catch (err) {
    console.error('[upload] error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /api/preview
 * 调用本地小程序预览码接口，返回二维码（image/* 自动转 base64 data URL）
 */
app.get('/api/preview', async (req, res) => {
  try {
    const result = await runFetchPreview();
    res.json(result);
  } catch (err) {
    console.error('[preview] error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/agent
 * 用自然语言驱动 Agent（需要配置 DEEPSEEK_API_KEY）
 * body: { message: string }
 */
app.post('/api/agent', async (req, res) => {
  try {
    const { message } = req.body || {};
    if (!message) return res.status(400).json({ ok: false, error: '缺少 message' });
    const out = await runAgent(message);
    res.json({ ok: true, ...out });
  } catch (err) {
    console.error('[agent] error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/* -------------------------------------------------------------------------- */

app.listen(PORT, () => {
  console.log(`\n  ✅ Excel-Agent 已启动`);
  console.log(`  ➜ Web:        http://127.0.0.1:${PORT}/`);
  console.log(`  ➜ data.json:  http://127.0.0.1:${PORT}/data.json`);
  console.log(`  ➜ 预览码 API:  GET  /api/preview`);
  console.log(`  ➜ 上传 API:   POST /api/upload (multipart, field=file)\n`);
});
