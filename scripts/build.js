/**
 * AI & 母婴行业晨报 — 自动化构建脚本
 * 每天定时运行，抓取 AI HOT 日报 + 母婴行业新闻，生成单文件 HTML 仪表盘
 *
 * 数据源:
 *   - AI HOT API (https://aihot.virxact.com/api/public/daily)
 *   - Google News RSS (母婴行业相关)
 *
 * 用法: node scripts/build.js
 */

const fs = require('fs');
const path = require('path');

// ========== 配置 ==========
const CONFIG = {
  AIHOT_DAILY_URL: 'https://aihot.virxact.com/api/public/daily',
  AIHOT_UA: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  GOOGLE_NEWS_RSS: 'https://news.google.com/rss/search?q=%E6%AF%8D%E5%A9%B4%E8%A1%8C%E4%B8%9A+OR+%E5%AD%95%E5%A9%B4%E7%AB%A5+OR+%E6%AF%8D%E5%A9%B4%E4%BA%A7%E5%93%81&hl=zh-CN&gl=CN&ceid=CN:zh-Hans',
  OUTPUT_PATH: path.resolve(__dirname, '..', 'index.html'),
};

// ========== 工具函数 ==========

/** 简单 XML RSS 解析 - 提取 item 节点 */
function parseRSSItems(xmlStr) {
  const items = [];
  // 匹配 <item>...</item> 块
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let match;
  while ((match = itemRegex.exec(xmlStr)) !== null) {
    const block = match[1];
    const getTag = (tag) => {
      const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
      const m = block.match(re);
      return m ? m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, '').trim() : '';
    };
    items.push({
      title: getTag('title'),
      link: getTag('link'),
      source: getTag('source'),
      pubDate: getTag('pubDate'),
      description: getTag('description'),
    });
  }
  return items;
}

/** ISO 时间转北京时间人话格式 */
function formatBeijingTime(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return '';
  const bj = new Date(d.getTime() + 8 * 3600 * 1000);
  const now = new Date();
  now.setHours(now.getHours() + 8); // 近似北京时间
  const month = bj.getMonth() + 1;
  const day = bj.getDate();
  const hours = String(bj.getHours()).padStart(2, '0');
  const mins = String(bj.getMinutes()).padStart(2, '0');

  const diffDays = Math.floor((now.getTime() - bj.getTime()) / 86400000);
  if (diffDays === 0) return `今天 ${hours}:${mins}`;
  if (diffDays === 1) return `昨天 ${hours}:${mins}`;
  if (diffDays < 7) return `${diffDays}天前`;
  return `${month}月${day}日`;
}

/** 截断文本到指定长度 */
function truncate(text, maxLen = 60) {
  if (!text) return '';
  return text.length > maxLen ? text.slice(0, maxLen - 1) + '…' : text;
}

/** HTML 转义 */
function escapeHtml(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ========== 数据获取 ==========

/** 获取 AI HOT 日报 */
async function fetchAIHOT() {
  console.log('[AI HOT] 正在获取日报...');
  try {
    const resp = await fetch(CONFIG.AIHOT_DAILY_URL, {
      headers: { 'User-Agent': CONFIG.AIHOT_UA },
      signal: AbortSignal.timeout(30000),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    console.log(`[AI HOT] 获取成功 — 日期: ${data.date}, ${data.sections?.length || 0} 个版块`);
    return data;
  } catch (err) {
    console.error(`[AI HOT] 获取失败: ${err.message}`);
    return null;
  }
}

/** 获取母婴行业新闻 (Google News RSS) */
async function fetchMaternalNews() {
  console.log('[母婴] 正在获取行业新闻...');
  try {
    const resp = await fetch(CONFIG.GOOGLE_NEWS_RSS, {
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const xml = await resp.text();
    const items = parseRSSItems(xml);
    // 筛选最近 72 小时内的新闻
    const cutoff = Date.now() - 72 * 3600 * 1000;
    const recent = items.filter((item) => {
      const d = new Date(item.pubDate);
      return !isNaN(d.getTime()) && d.getTime() > cutoff;
    });
    console.log(`[母婴] 获取成功 — ${recent.length} 条近期新闻`);
    return recent.slice(0, 15);
  } catch (err) {
    console.error(`[母婴] 获取失败: ${err.message}`);
    return [];
  }
}

// ========== 数据整理 ==========

/** 将 AI HOT 数据整理为统一的条目格式 */
function normalizeAIItems(dailyData) {
  if (!dailyData || !dailyData.sections) return [];
  const allItems = [];
  const categoryMap = {
    '模型发布/更新': 'models',
    '产品发布/更新': 'products',
    '行业动态': 'industry',
    '论文研究': 'paper',
    '技巧与观点': 'tip',
  };

  for (const section of dailyData.sections) {
    const cat = categoryMap[section.label] || 'industry';
    for (const item of section.items || []) {
      allItems.push({
        category: cat,
        title: item.title,
        summary: truncate(item.summary, 60),
        source: item.sourceName || '',
        sourceUrl: item.sourceUrl || '',
        time: formatBeijingTime(dailyData.windowEnd || dailyData.date),
        isMaternal: false,
        isRoot: false,
      });
    }
  }
  return allItems;
}

/** 将母婴 RSS 数据整理为统一格式 */
function normalizeMaternalItems(rssItems) {
  return rssItems.map((item) => ({
    category: 'industry', // 默认归入行业动态
    title: item.title,
    summary: truncate(item.description, 60),
    source: item.source || '行业新闻',
    sourceUrl: item.link || '',
    time: formatBeijingTime(item.pubDate),
    isMaternal: true,
    isRoot: item.title.includes('路特') || item.title.includes('ROOT') || item.title.includes('Momcozy') || item.title.includes('Babycare'),
  }));
}

// ========== HTML 生成 ==========

function generateHTML(items, reportDate) {
  // 按 category 分组
  const sections = {
    models: { label: '模型发布 / 更新', icon: '🤖', cls: 'models', iconCls: 'icon-models', items: [] },
    products: { label: '产品发布 / 更新', icon: '🚀', cls: 'products', iconCls: 'icon-products', items: [] },
    industry: { label: '行业动态', icon: '📡', cls: 'industry', iconCls: 'icon-industry', items: [] },
    paper: { label: '论文研究', icon: '📄', cls: 'paper', iconCls: 'icon-paper', items: [] },
    tip: { label: '技巧与观点', icon: '💡', cls: 'tip', iconCls: 'icon-tip', items: [] },
  };

  let globalNum = 0;
  for (const item of items) {
    globalNum++;
    item.num = globalNum;
    if (sections[item.category]) {
      sections[item.category].items.push(item);
    } else {
      sections.industry.items.push(item);
    }
  }

  const totalCount = items.length;
  const sectionKeys = ['models', 'products', 'industry', 'paper', 'tip'];

  // 生成卡片 HTML
  function renderCard(item) {
    const chipClass = item.isRoot ? 'source-chip root' : item.isMaternal ? 'source-chip maternal' : 'source-chip';
    return `
    <article class="card ${escapeHtml(item.category)}">
      <div class="card-header"><span class="card-num">#${item.num}</span><h3 class="card-title">${escapeHtml(item.title)}</h3></div>
      <div class="card-meta"><span class="${chipClass}">${escapeHtml(item.source)}</span></div>
      <p class="card-summary">${escapeHtml(item.summary)}</p>
      <div class="card-footer">
        <span class="card-time">${escapeHtml(item.time)}</span>
        ${item.sourceUrl ? `<a href="${escapeHtml(item.sourceUrl)}" target="_blank" rel="noopener noreferrer" class="card-link">原文</a>` : ''}
      </div>
    </article>`;
  }

  // 生成各版块
  let sectionsHTML = '';
  let hasMaternalDivider = false;
  for (const key of sectionKeys) {
    const sec = sections[key];
    const aiItems = sec.items.filter((i) => !i.isMaternal);
    const maternalItems = sec.items.filter((i) => i.isMaternal);

    sectionsHTML += `
  <section id="sec-${key}">
    <div class="section-header">
      <div class="section-icon ${sec.iconCls}">${sec.icon}</div>
      <h2>${sec.label}</h2>
      <span class="section-count">${sec.items.length} 条</span>
    </div>
    <div class="card-grid">
${aiItems.map(renderCard).join('\n')}`;

    if (maternalItems.length > 0) {
      sectionsHTML += `
      <div class="section-divider">▼ 母婴行业</div>
${maternalItems.map(renderCard).join('\n')}`;
    }
    sectionsHTML += `
    </div>
  </section>`;
  }

  // 统计各版块数量
  const statsHTML = sectionKeys
    .map((k) => {
      const colors = { models: '#a78bfa', products: '#60a5fa', industry: '#fbbf24', paper: '#34d399', tip: '#f472b6' };
      return `<div class="hero-stat"><div class="hero-stat-num" style="color:${colors[k]}">${sections[k].items.length}</div><div class="hero-stat-label">${sections[k].label.split(' ')[0]}</div></div>`;
    })
    .join('\n');

  const totalAI = items.filter((i) => !i.isMaternal).length;
  const totalMaternal = items.filter((i) => i.isMaternal).length;

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>AI & 母婴行业晨报 · ${reportDate}</title>
<meta name="description" content="每日 AI 与母婴行业精选资讯，${totalCount} 条实时更新">
<meta property="og:title" content="AI & 母婴行业晨报 · ${reportDate}">
<meta property="og:description" content="${totalAI} 条 AI 资讯 + ${totalMaternal} 条母婴行业动态">
<meta property="og:type" content="website">
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html{scroll-behavior:smooth}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;background:#f5f5f7;color:#1d1d1f;line-height:1.6;-webkit-font-smoothing:antialiased}
.hero{background:linear-gradient(135deg,#1a1a2e 0%,#16213e 50%,#0f3460 100%);color:#fff;padding:48px 24px 40px;text-align:center;position:relative;overflow:hidden}
.hero::before{content:'';position:absolute;top:-50%;left:-50%;width:200%;height:200%;background:radial-gradient(ellipse at 30% 50%,rgba(99,102,241,0.15) 0%,transparent 60%),radial-gradient(ellipse at 70% 50%,rgba(236,72,153,0.1) 0%,transparent 60%);animation:heroGlow 12s ease-in-out infinite}
@keyframes heroGlow{0%,100%{transform:translate(0,0)}50%{transform:translate(2%,1%)}}
.hero-content{position:relative;z-index:1;max-width:900px;margin:0 auto}
.hero-badge{display:inline-block;background:rgba(255,255,255,0.12);border:1px solid rgba(255,255,255,0.2);border-radius:20px;padding:4px 16px;font-size:13px;letter-spacing:0.5px;margin-bottom:16px;backdrop-filter:blur(10px)}
.hero h1{font-size:clamp(24px,4vw,36px);font-weight:700;margin-bottom:8px;background:linear-gradient(135deg,#e0e7ff,#f0abfc);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
.hero-date{font-size:15px;color:rgba(255,255,255,0.7);margin-bottom:24px}
.hero-total{font-size:48px;font-weight:800;line-height:1;margin-bottom:4px;color:#fff}
.hero-total-label{font-size:13px;color:rgba(255,255,255,0.5);margin-bottom:20px}
.hero-stats{display:flex;justify-content:center;gap:8px;flex-wrap:wrap}
.hero-stat{background:rgba(255,255,255,0.08);border-radius:10px;padding:10px 16px;min-width:80px;backdrop-filter:blur(10px);border:1px solid rgba(255,255,255,0.08);transition:transform 0.2s,background 0.2s}
.hero-stat:hover{transform:translateY(-2px);background:rgba(255,255,255,0.14)}
.hero-stat-num{font-size:22px;font-weight:700}
.hero-stat-label{font-size:11px;color:rgba(255,255,255,0.55);margin-top:2px}
.nav-bar{position:sticky;top:0;z-index:100;background:rgba(255,255,255,0.85);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);border-bottom:1px solid rgba(0,0,0,0.06);padding:0 16px}
.nav-inner{max-width:1200px;margin:0 auto;display:flex;gap:2px;overflow-x:auto;scrollbar-width:none;-ms-overflow-style:none;padding:8px 0}
.nav-inner::-webkit-scrollbar{display:none}
.nav-link{flex-shrink:0;padding:7px 16px;border-radius:18px;font-size:13px;color:#555;text-decoration:none;transition:all 0.2s;white-space:nowrap;font-weight:500}
.nav-link:hover{background:rgba(99,102,241,0.08);color:#6366f1}
.nav-link.active{background:#6366f1;color:#fff}
.nav-link .nav-count{display:inline-block;background:rgba(0,0,0,0.06);border-radius:10px;padding:1px 7px;font-size:11px;margin-left:4px;font-weight:600}
.nav-link.active .nav-count{background:rgba(255,255,255,0.25)}
.main{max-width:1200px;margin:0 auto;padding:24px 16px 48px}
.section-header{display:flex;align-items:center;gap:10px;margin:36px 0 16px;padding-bottom:10px;border-bottom:2px solid #e5e7eb;scroll-margin-top:72px}
.section-header:first-of-type{margin-top:8px}
.section-icon{width:32px;height:32px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0}
.section-header h2{font-size:20px;font-weight:700}
.section-header .section-count{font-size:13px;color:#888;background:#f3f4f6;padding:2px 10px;border-radius:12px;font-weight:500}
.icon-models{background:#ede9fe;color:#7c3aed}
.icon-products{background:#dbeafe;color:#2563eb}
.icon-industry{background:#fef3c7;color:#d97706}
.icon-paper{background:#d1fae5;color:#059669}
.icon-tip{background:#fce7f3;color:#db2777}
.card-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:14px}
.card{background:#fff;border-radius:12px;padding:16px 18px;border:1px solid #e5e7eb;transition:box-shadow 0.2s,transform 0.2s,border-color 0.2s;display:flex;flex-direction:column;gap:8px;position:relative;overflow:hidden}
.card:hover{box-shadow:0 4px 20px rgba(0,0,0,0.08);transform:translateY(-2px);border-color:#d1d5db}
.card::before{content:'';position:absolute;top:0;left:0;width:3px;height:100%;border-radius:3px 0 0 3px}
.card.models::before{background:#7c3aed}
.card.products::before{background:#2563eb}
.card.industry::before{background:#d97706}
.card.paper::before{background:#059669}
.card.tip::before{background:#db2777}
.card-header{display:flex;align-items:flex-start;justify-content:space-between;gap:8px}
.card-num{font-size:12px;font-weight:700;color:#9ca3af;flex-shrink:0;min-width:24px}
.card-title{font-size:14px;font-weight:600;color:#1f2937;line-height:1.4;flex:1}
.card-meta{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.source-chip{display:inline-flex;align-items:center;gap:3px;font-size:11px;color:#6b7280;background:#f3f4f6;padding:2px 8px;border-radius:10px;white-space:nowrap;max-width:180px;overflow:hidden;text-overflow:ellipsis}
.source-chip.maternal{background:#fce7f3;color:#be185d}
.source-chip.root{background:#dbeafe;color:#1d4ed8}
.card-summary{font-size:13px;color:#6b7280;line-height:1.5;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.card-footer{display:flex;align-items:center;justify-content:space-between;margin-top:auto}
.card-time{font-size:11px;color:#9ca3af}
.card-link{font-size:12px;color:#6366f1;text-decoration:none;font-weight:500;display:inline-flex;align-items:center;gap:3px;transition:color 0.2s}
.card-link:hover{color:#4f46e5}
.card-link::after{content:' ↗';font-size:10px}
.section-divider{margin:20px 16px;padding:8px 16px;background:linear-gradient(135deg,#fef2f2,#fff7ed);border-radius:8px;border:1px dashed #fecaca;font-size:12px;color:#b45309;text-align:center;grid-column:1/-1}
.footer{max-width:1200px;margin:0 auto;padding:24px 16px 32px;text-align:center;border-top:1px solid #e5e7eb}
.footer p{font-size:12px;color:#9ca3af;margin-bottom:4px}
.footer p strong{color:#6366f1}
.footer .footer-sources{font-size:11px;color:#d1d5db;margin-top:8px}
.footer a{color:#9ca3af}
@media(max-width:768px){.hero{padding:32px 16px 28px}.hero-total{font-size:36px}.hero-stats{gap:4px}.hero-stat{padding:8px 12px;min-width:64px}.hero-stat-num{font-size:18px}.card-grid{grid-template-columns:1fr}.section-header h2{font-size:17px}.nav-link{padding:6px 12px;font-size:12px}}
@media(max-width:480px){.hero h1{font-size:20px}.hero-date{font-size:13px}.hero-stat{padding:6px 10px;min-width:56px}.hero-stat-num{font-size:16px}.hero-stat-label{font-size:10px}}
</style>
</head>
<body>
<header class="hero"><div class="hero-content">
<div class="hero-badge">AI & 母婴行业 · 晨报</div>
<h1>AI 与母婴行业日报</h1>
<div class="hero-date">${reportDate} · 北京时间</div>
<div class="hero-total">${totalCount}</div>
<div class="hero-total-label">条精选资讯（AI ${totalAI} 条 + 母婴 ${totalMaternal} 条）</div>
<div class="hero-stats">${statsHTML}</div>
</div></header>

<nav class="nav-bar" id="navBar"><div class="nav-inner">
<a href="#sec-models" class="nav-link" data-section="models">🤖 模型发布 <span class="nav-count">${sections.models.items.length}</span></a>
<a href="#sec-products" class="nav-link" data-section="products">🚀 产品发布 <span class="nav-count">${sections.products.items.length}</span></a>
<a href="#sec-industry" class="nav-link" data-section="industry">📡 行业动态 <span class="nav-count">${sections.industry.items.length}</span></a>
<a href="#sec-paper" class="nav-link" data-section="paper">📄 论文研究 <span class="nav-count">${sections.paper.items.length}</span></a>
<a href="#sec-tip" class="nav-link" data-section="tip">💡 技巧与观点 <span class="nav-count">${sections.tip.items.length}</span></a>
</div></nav>

<main class="main">
${sectionsHTML}
</main>

<footer class="footer">
<p>本报告共收录 <strong>${totalCount} 条</strong>精选资讯（AI 行业 ${totalAI} 条 + 母婴行业 ${totalMaternal} 条）</p>
<p>AI 数据来源：<a href="https://aihot.virxact.com" target="_blank">AI HOT 日报</a> | 母婴数据来源：<a href="https://news.google.com" target="_blank">Google News</a></p>
<p class="footer-sources">生成时间：${reportDate} · 每日北京时间 08:00 自动更新 · <a href="https://github.com" target="_blank">GitHub Actions 驱动</a></p>
</footer>

<script>
(function(){const l=document.querySelectorAll('.nav-link'),s=document.querySelectorAll('section[id]');function o(){let c='';s.forEach(e=>{if(e.getBoundingClientRect().top<=120)c=e.id});l.forEach(e=>{e.classList.toggle('active',e.getAttribute('data-section')===c)})}window.addEventListener('scroll',o,{passive:true});o();l.forEach(e=>{e.addEventListener('click',function(){l.forEach(n=>n.classList.remove('active'));this.classList.add('active')})})})();
</script>
</body>
</html>`;
}

// ========== 主流程 ==========

async function main() {
  const now = new Date();
  now.setHours(now.getHours() + 8); // 转北京时间
  const dateStr = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日`;
  console.log(`\n========== AI & 母婴行业晨报构建 ==========`);
  console.log(`时间: ${dateStr} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`);

  // 1. 获取 AI HOT 日报
  const dailyData = await fetchAIHOT();
  const aiItems = normalizeAIItems(dailyData);

  // 2. 获取母婴行业新闻
  const maternalRSS = await fetchMaternalNews();
  const maternalItems = normalizeMaternalItems(maternalRSS);

  // 3. 合并
  const allItems = [...aiItems, ...maternalItems];
  console.log(`\n总计: ${allItems.length} 条 (AI: ${aiItems.length}, 母婴: ${maternalItems.length})`);

  // 4. 生成 HTML
  const html = generateHTML(allItems, dateStr);

  // 5. 写入文件
  fs.writeFileSync(CONFIG.OUTPUT_PATH, html, 'utf-8');
  console.log(`\n✅ 报告已生成: ${CONFIG.OUTPUT_PATH}`);
  console.log(`   文件大小: ${(html.length / 1024).toFixed(1)} KB\n`);
}

main().catch((err) => {
  console.error('构建失败:', err);
  process.exit(1);
});
