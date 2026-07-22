/**
 * ROOT 母婴产品行业新闻站 — 自动化构建脚本
 * 每天定时运行，多渠道抓取母婴行业新闻，生成单文件 HTML 仪表盘
 *
 * 用法: node scripts/build.js
 */

const fs = require('fs');
const path = require('path');

// ========== 配置 ==========
const CONFIG = {
  // 五个版块各自的关键词搜索，覆盖母婴产品行业全维度
  RSS_FEEDS: [
    // 🍼 新品速递
    { category: 'newproducts', query: '母婴新品+OR+婴儿新品+OR+孕婴童+新产品+OR+儿童新品' },
    // 📋 行业政策
    { category: 'policy', query: '母婴政策+OR+婴幼儿食品+监管+OR+母婴+标准+OR+婴配粉+政策' },
    // 📊 市场洞察
    { category: 'market', query: '母婴市场+OR+母婴行业+趋势+OR+孕婴童+数据+OR+母婴消费' },
    // 🏢 品牌动态
    { category: 'brands', query: '母婴品牌+OR+婴童企业+OR+奶粉+OR+纸尿裤+OR+婴幼+公司' },
    // 🌍 跨境出海
    { category: 'crossborder', query: '母婴出海+OR+跨境电商+母婴+OR+Amazon+母婴+OR+独立站+母婴' },
  ],
  OUTPUT_PATH: path.resolve(__dirname, '..', 'index.html'),
};

// ========== 版块定义 ==========
const SECTIONS = {
  newproducts: { label: '新品速递', icon: '🍼', color: '#f472b6', bg: '#fce7f3' },
  policy:      { label: '行业政策', icon: '📋', color: '#f59e0b', bg: '#fef3c7' },
  market:      { label: '市场洞察', icon: '📊', color: '#3b82f6', bg: '#dbeafe' },
  brands:      { label: '品牌动态', icon: '🏢', color: '#8b5cf6', bg: '#ede9fe' },
  crossborder: { label: '跨境出海', icon: '🌍', color: '#10b981', bg: '#d1fae5' },
};

const SECTION_KEYS = ['newproducts', 'policy', 'market', 'brands', 'crossborder'];

// ========== 工具函数 ==========

function parseRSSItems(xmlStr) {
  const items = [];
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

function formatBeijingTime(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return '';
  const bj = new Date(d.getTime() + 8 * 3600 * 1000);
  const now = new Date();
  const diffDays = Math.floor((Date.now() - bj.getTime()) / 86400000);
  if (diffDays === 0) return '今天';
  if (diffDays === 1) return '昨天';
  if (diffDays < 7) return `${diffDays}天前`;
  const month = bj.getMonth() + 1;
  return `${month}月${bj.getDate()}日`;
}

function truncate(text, maxLen = 60) {
  if (!text) return '';
  return text.length > maxLen ? text.slice(0, maxLen - 1) + '…' : text;
}

function escapeHtml(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** 去重：基于标题前40字的相似度 */
function dedup(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = item.title.slice(0, 40).replace(/\s+/g, '');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ========== 数据获取 ==========

async function fetchRSS(query) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=zh-CN&gl=CN&ceid=CN:zh-Hans`;
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const xml = await resp.text();
    const items = parseRSSItems(xml);
    const cutoff = Date.now() - 72 * 3600 * 1000;
    return items.filter((item) => {
      const d = new Date(item.pubDate);
      return !isNaN(d.getTime()) && d.getTime() > cutoff;
    });
  } catch (err) {
    console.error(`  RSS 请求失败: ${err.message}`);
    return [];
  }
}

async function fetchAllNews() {
  console.log('[ROOT 母婴新闻站] 开始多渠道抓取...\n');
  const allItems = [];
  const seenTitles = new Set();

  for (const feed of CONFIG.RSS_FEEDS) {
    const sec = SECTIONS[feed.category];
    console.log(`  ${sec.icon} ${sec.label} — 搜索中...`);
    const items = await fetchRSS(feed.query);
    console.log(`    获取 ${items.length} 条`);

    for (const item of items) {
      // 跨版块去重
      const dedupKey = item.title.slice(0, 50).replace(/\s+/g, '').toLowerCase();
      if (seenTitles.has(dedupKey)) continue;
      seenTitles.add(dedupKey);

      allItems.push({
        category: feed.category,
        title: item.title,
        summary: truncate(item.description, 60),
        source: item.source || '行业新闻',
        sourceUrl: item.link || '',
        time: formatBeijingTime(item.pubDate),
      });
    }
  }

  // 版块内去重
  const finalItems = [];
  for (const key of SECTION_KEYS) {
    const catItems = dedup(allItems.filter((i) => i.category === key));
    finalItems.push(...catItems);
  }

  // 总数不够时，从行业动态补充
  const extra = dedup(allItems.filter((i) => !finalItems.includes(i)));
  finalItems.push(...extra.slice(0, Math.max(0, 30 - finalItems.length)));

  return dedup(finalItems).slice(0, 60);
}

// ========== HTML 生成 ==========

function generateHTML(items, reportDate) {
  // 分组并编号
  const sections = {};
  for (const key of SECTION_KEYS) {
    sections[key] = { ...SECTIONS[key], items: [] };
  }

  let globalNum = 0;
  for (const item of items) {
    globalNum++;
    item.num = globalNum;
    const cat = item.category;
    if (sections[cat]) {
      sections[cat].items.push(item);
    } else {
      sections.brands.items.push(item);
    }
  }

  const totalCount = items.length;

  // 卡片渲染
  function renderCard(item) {
    const sec = SECTIONS[item.category];
    const catClass = item.category;
    return `
    <article class="card ${catClass}">
      <div class="card-header"><span class="card-num">#${item.num}</span><h3 class="card-title">${escapeHtml(item.title)}</h3></div>
      <div class="card-meta"><span class="source-chip" style="background:${sec.bg};color:${sec.color}">${escapeHtml(item.source)}</span></div>
      <p class="card-summary">${escapeHtml(item.summary)}</p>
      <div class="card-footer">
        <span class="card-time">${escapeHtml(item.time)}</span>
        ${item.sourceUrl ? `<a href="${escapeHtml(item.sourceUrl)}" target="_blank" rel="noopener noreferrer" class="card-link">原文</a>` : ''}
      </div>
    </article>`;
  }

  // 版块 HTML
  let sectionsHTML = '';
  for (const key of SECTION_KEYS) {
    const sec = sections[key];
    const cls = `icon-${key}`;
    sectionsHTML += `
  <section id="sec-${key}">
    <div class="section-header">
      <div class="section-icon ${cls}">${sec.icon}</div>
      <h2>${sec.label}</h2>
      <span class="section-count">${sec.items.length} 条</span>
    </div>
    <div class="card-grid">
${sec.items.map(renderCard).join('\n')}
    </div>
  </section>`;
  }

  // 统计
  const statsHTML = SECTION_KEYS
    .map((k) => `<div class="hero-stat"><div class="hero-stat-num" style="color:${SECTIONS[k].color}">${sections[k].items.length}</div><div class="hero-stat-label">${SECTIONS[k].label}</div></div>`)
    .join('\n');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>ROOT 母婴产品行业新闻 · ${reportDate}</title>
<meta name="description" content="ROOT | 每日母婴产品行业精选资讯，${totalCount} 条实时更新">
<meta property="og:title" content="ROOT 母婴产品行业新闻 · ${reportDate}">
<meta property="og:description" content="每日母婴产品行业精选资讯，覆盖新品速递、行业政策、市场洞察、品牌动态、跨境出海">
<meta property="og:type" content="website">
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html{scroll-behavior:smooth}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;background:#f8fafc;color:#1e293b;line-height:1.6;-webkit-font-smoothing:antialiased}

/* Hero — ROOT 品牌色 */
.hero{background:linear-gradient(135deg,#0f172a 0%,#1e3a5f 40%,#2563eb 100%);color:#fff;padding:56px 24px 48px;text-align:center;position:relative;overflow:hidden}
.hero::before{content:'';position:absolute;inset:0;background:radial-gradient(ellipse at 20% 50%,rgba(37,99,235,0.3) 0%,transparent 50%),radial-gradient(ellipse at 80% 50%,rgba(16,185,129,0.1) 0%,transparent 50%)}
.hero-content{position:relative;z-index:1;max-width:900px;margin:0 auto}
.hero-logo{font-size:28px;font-weight:800;letter-spacing:2px;margin-bottom:4px}
.hero-logo span{color:#60a5fa}
.hero-badge{display:inline-block;background:rgba(255,255,255,0.15);border:1px solid rgba(255,255,255,0.25);border-radius:20px;padding:5px 20px;font-size:13px;letter-spacing:1px;margin-bottom:20px;backdrop-filter:blur(10px)}
.hero h1{font-size:clamp(22px,3.5vw,32px);font-weight:600;margin-bottom:8px;color:rgba(255,255,255,0.95)}
.hero-date{font-size:15px;color:rgba(255,255,255,0.6);margin-bottom:24px}
.hero-total{font-size:52px;font-weight:800;line-height:1;margin-bottom:4px;color:#fff}
.hero-total-label{font-size:14px;color:rgba(255,255,255,0.5);margin-bottom:20px}
.hero-stats{display:flex;justify-content:center;gap:8px;flex-wrap:wrap}
.hero-stat{background:rgba(255,255,255,0.1);border-radius:12px;padding:12px 20px;min-width:90px;backdrop-filter:blur(10px);border:1px solid rgba(255,255,255,0.08);transition:transform 0.2s,background 0.2s}
.hero-stat:hover{transform:translateY(-2px);background:rgba(255,255,255,0.18)}
.hero-stat-num{font-size:24px;font-weight:700}
.hero-stat-label{font-size:11px;color:rgba(255,255,255,0.5);margin-top:3px}

/* Nav */
.nav-bar{position:sticky;top:0;z-index:100;background:rgba(255,255,255,0.9);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);border-bottom:1px solid #e2e8f0;padding:0 16px}
.nav-inner{max-width:1200px;margin:0 auto;display:flex;gap:2px;overflow-x:auto;scrollbar-width:none;padding:8px 0}
.nav-inner::-webkit-scrollbar{display:none}
.nav-link{flex-shrink:0;padding:7px 18px;border-radius:20px;font-size:13px;color:#64748b;text-decoration:none;transition:all 0.2s;white-space:nowrap;font-weight:500}
.nav-link:hover{background:#eff6ff;color:#2563eb}
.nav-link.active{background:#2563eb;color:#fff}
.nav-link .nav-count{display:inline-block;background:rgba(0,0,0,0.06);border-radius:10px;padding:1px 8px;font-size:11px;margin-left:5px;font-weight:600}
.nav-link.active .nav-count{background:rgba(255,255,255,0.25)}

/* Main */
.main{max-width:1200px;margin:0 auto;padding:24px 16px 56px}

/* Section header */
.section-header{display:flex;align-items:center;gap:10px;margin:40px 0 18px;padding-bottom:12px;border-bottom:2px solid #e2e8f0;scroll-margin-top:72px}
.section-header:first-of-type{margin-top:8px}
.section-icon{width:34px;height:34px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:17px;flex-shrink:0}
.section-header h2{font-size:20px;font-weight:700;color:#1e293b}
.section-header .section-count{font-size:13px;color:#94a3b8;background:#f1f5f9;padding:2px 12px;border-radius:12px;font-weight:500}

/* Icons per section */
.icon-newproducts{background:#fce7f3;color:#db2777}
.icon-policy{background:#fef3c7;color:#d97706}
.icon-market{background:#dbeafe;color:#2563eb}
.icon-brands{background:#ede9fe;color:#7c3aed}
.icon-crossborder{background:#d1fae5;color:#059669}

/* Card grid */
.card-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:14px}
.card{background:#fff;border-radius:14px;padding:18px 20px;border:1px solid #e2e8f0;transition:box-shadow 0.2s,transform 0.2s;display:flex;flex-direction:column;gap:8px;position:relative;overflow:hidden}
.card:hover{box-shadow:0 8px 30px rgba(0,0,0,0.08);transform:translateY(-2px)}
.card::before{content:'';position:absolute;top:0;left:0;width:4px;height:100%;border-radius:4px 0 0 4px}
.card.newproducts::before{background:#db2777}
.card.policy::before{background:#d97706}
.card.market::before{background:#2563eb}
.card.brands::before{background:#7c3aed}
.card.crossborder::before{background:#059669}

.card-header{display:flex;align-items:flex-start;gap:10px}
.card-num{font-size:12px;font-weight:700;color:#cbd5e1;flex-shrink:0;min-width:24px;margin-top:1px}
.card-title{font-size:15px;font-weight:600;color:#1e293b;line-height:1.4;flex:1}
.card-meta{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.source-chip{display:inline-flex;align-items:center;font-size:11px;padding:2px 10px;border-radius:10px;white-space:nowrap;max-width:180px;overflow:hidden;text-overflow:ellipsis;font-weight:500}
.card-summary{font-size:13px;color:#64748b;line-height:1.5;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.card-footer{display:flex;align-items:center;justify-content:space-between;margin-top:auto}
.card-time{font-size:11px;color:#94a3b8}
.card-link{font-size:12px;color:#2563eb;text-decoration:none;font-weight:600;display:inline-flex;align-items:center;gap:3px;transition:color 0.2s}
.card-link:hover{color:#1d4ed8}
.card-link::after{content:' ↗';font-size:10px}

/* Footer */
.footer{max-width:1200px;margin:0 auto;padding:28px 16px 36px;text-align:center;border-top:1px solid #e2e8f0}
.footer p{font-size:13px;color:#94a3b8;margin-bottom:4px}
.footer .footer-brand{font-size:14px;font-weight:700;color:#1e293b;margin-bottom:8px}
.footer .footer-brand span{color:#2563eb}
.footer .footer-sources{font-size:11px;color:#cbd5e1;margin-top:8px}
.footer a{color:#94a3b8}

/* Empty state */
.empty-state{grid-column:1/-1;text-align:center;padding:32px 16px;color:#94a3b8;font-size:14px}

@media(max-width:768px){
  .hero{padding:40px 16px 32px}.hero-total{font-size:38px}.hero-logo{font-size:22px}
  .hero-stats{gap:4px}.hero-stat{padding:10px 14px;min-width:70px}.hero-stat-num{font-size:20px}
  .card-grid{grid-template-columns:1fr}.section-header h2{font-size:17px}
  .nav-link{padding:6px 14px;font-size:12px}
}
@media(max-width:480px){
  .hero h1{font-size:18px}.hero-date{font-size:13px}
  .hero-stat{padding:8px 10px;min-width:60px}.hero-stat-num{font-size:18px}.hero-stat-label{font-size:10px}
}
</style>
</head>
<body>

<header class="hero">
  <div class="hero-content">
    <div class="hero-logo">R<span>OO</span>T</div>
    <div class="hero-badge">母婴产品 · 行业新闻</div>
    <h1>全球母婴产品行业日报</h1>
    <div class="hero-date">${reportDate} · 北京时间 每日 08:00 更新</div>
    <div class="hero-total">${totalCount}</div>
    <div class="hero-total-label">条精选资讯</div>
    <div class="hero-stats">${statsHTML}</div>
  </div>
</header>

<nav class="nav-bar" id="navBar"><div class="nav-inner">
${SECTION_KEYS.map((k) => `<a href="#sec-${k}" class="nav-link" data-section="${k}">${SECTIONS[k].icon} ${SECTIONS[k].label} <span class="nav-count">${sections[k].items.length}</span></a>`).join('\n')}
</div></nav>

<main class="main">
${sectionsHTML}
</main>

<footer class="footer">
  <div class="footer-brand">R<span>OO</span>T · 路特创新</div>
  <p>本报告共收录 <strong>${totalCount} 条</strong>全球母婴产品行业精选资讯</p>
  <p class="footer-sources">数据来源：Google News · 生成时间：${reportDate} · 每日北京时间 08:00 自动更新</p>
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
  const bjTime = new Date(now.getTime() + 8 * 3600 * 1000);
  const dateStr = `${bjTime.getFullYear()}年${bjTime.getMonth() + 1}月${bjTime.getDate()}日`;

  console.log(`\n========================================`);
  console.log(`  ROOT 母婴产品行业新闻站`);
  console.log(`  ${dateStr} ${String(bjTime.getHours()).padStart(2, '0')}:${String(bjTime.getMinutes()).padStart(2, '0')}`);
  console.log(`========================================\n`);

  const items = await fetchAllNews();

  console.log(`\n📊 总计: ${items.length} 条\n`);

  for (const key of SECTION_KEYS) {
    const n = items.filter((i) => i.category === key).length;
    console.log(`  ${SECTIONS[key].icon} ${SECTIONS[key].label}: ${n} 条`);
  }

  const html = generateHTML(items, dateStr);
  fs.writeFileSync(CONFIG.OUTPUT_PATH, html, 'utf-8');
  console.log(`\n✅ 报告已生成: ${CONFIG.OUTPUT_PATH}`);
  console.log(`   文件大小: ${(html.length / 1024).toFixed(1)} KB\n`);
}

main().catch((err) => {
  console.error('构建失败:', err);
  process.exit(1);
});
