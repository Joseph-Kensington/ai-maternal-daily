# AI & 母婴行业每日晨报

每天早上 8:00（北京时间）自动抓取 AI 行业和母婴行业最新资讯，生成单文件 HTML 仪表盘，部署到 GitHub Pages 公网访问。

## 数据源

| 来源 | 说明 |
|---|---|
| [AI HOT](https://aihot.virxact.com) | AI 行业日报 API，5 个版块：模型发布、产品发布、行业动态、论文研究、技巧与观点 |
| [Google News RSS](https://news.google.com) | 母婴行业相关中文新闻（母婴、孕婴童、母婴产品） |

## 架构

```
ai-maternal-daily/
├── .github/workflows/daily-update.yml   # GitHub Actions 定时任务
├── scripts/build.js                     # 数据抓取 + HTML 生成
├── index.html                           # 生成的仪表盘（GitHub Pages 入口）
└── package.json
```

- **构建脚本** `scripts/build.js`：零依赖（仅用 Node.js 内置 fetch + fs），运行 `node scripts/build.js`
- **定时任务**：GitHub Actions `cron: '0 0 * * *'` = 北京时间每天 08:00
- **部署**：GitHub Pages 直接托管 `index.html`

## 快速部署

### 1. 创建 GitHub 仓库

在 GitHub 上创建一个**公开**仓库，例如 `ai-maternal-daily`。

### 2. 推送代码

```bash
cd ai-maternal-daily
git remote add origin https://github.com/<你的用户名>/ai-maternal-daily.git
git push -u origin main
```

### 3. 启用 GitHub Pages

进入仓库 Settings → Pages：
- Source: **Deploy from a branch**
- Branch: **main** → `/ (root)**
- 点击 Save

等待几分钟，你的网站就在 `https://<你的用户名>.github.io/ai-maternal-daily/` 上线了。

### 4. 手动触发首次构建

进入仓库 Actions 页面 → 选择 "Daily AI & Maternal-Baby Report" → **Run workflow**

### 5. （可选）绑定自定义域名

在 Settings → Pages → Custom domain 中绑定你自己的域名。

## 本地运行

```bash
node scripts/build.js    # 生成 index.html
npx serve .              # 本地预览
```

## 许可证

MIT
