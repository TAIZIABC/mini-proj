# 📚 docs · 技术文章素材

这里是项目配套的技术文章素材，可直接拿去发公众号 / 掘金 / 知乎 / 小红书。

## 文件清单

| 文件 | 作用 | 何时用 |
|---|---|---|
| [`article.md`](./article.md) | **主文章初稿**（2800+ 字，7 章结构） | 发布前先过一遍，把 `[GitHub repo 地址]` 之类占位符替换成真实链接 |
| [`diagrams.md`](./diagrams.md) | 3 张 Mermaid 图 + 1 张 ASCII 备用图 | 导出成 PNG/SVG 插进文章（推荐 [mermaid.live](https://mermaid.live)） |
| [`code-snippets.md`](./code-snippets.md) | 精选 4 段代码片段 + 坑点速查表 | 用 [carbon.now.sh](https://carbon.now.sh) 生成好看的代码图 |
| [`publish-checklist.md`](./publish-checklist.md) | 3 个标题方案 · 4 平台改造清单 · 视觉资产清单 | 发布前对着清单自检 |

## 发布流程（建议）

1. **完善** `article.md`：
   - 替换 `[GitHub repo 地址]` / `[Issue 区地址]` 等占位符
   - 把 `🎬 [此处插入 GIF]` / `🖼 [此处插入截图]` 换成真实图片链接
2. **生成图片**：
   - 录封面 GIF（LICEcap / Kap，5 秒）
   - `diagrams.md` 里的 Mermaid → mermaid.live 导出 PNG
   - `code-snippets.md` 里的代码 → carbon.now.sh 截图
   - UI 截图 → macOS Cmd+Shift+4
3. **按平台改造**：参考 `publish-checklist.md` 对应小节
4. **发布后 48h 观察指标**：完读率 / 收藏率 / 转发率

## 三个金句（转发抓手）

> 代码负责确定性，LLM 负责语义。

> Agent 不是更聪明的 Chat，是更自由的工作流。

> 你的第一个有用 Agent，可能就躲在最烦的那个重复劳动里。
