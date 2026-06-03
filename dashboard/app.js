// ══════════════════════════════════════════════════════════════════════════
// POIROT DASHBOARD — Frontend Application
// ══════════════════════════════════════════════════════════════════════════

const API_BASE = window.location.origin;
let currentLang = 'en';

// ── i18n Translations ──────────────────────────────────────────────────
const i18n = {
  en: {
    'hero.badge': 'AI-Powered Fact Intelligence',
    'hero.title1': 'Verify Truth.',
    'hero.title2': 'Fight Misinformation.',
    'hero.subtitle': 'Multi-agent AI engine with trust scoring, knowledge graph reasoning, and real-time misinformation detection — built for Bangladesh, scalable globally.',
    'hero.cta1': 'Verify a Claim',
    'hero.cta2': 'View Dashboard',
    'stats.total': 'Claims Verified',
    'stats.false': 'Misinfo Detected',
    'stats.trust': 'Avg Trust Score',
    'stats.latency': 'Avg Response',
    'verify.title': 'Verify a Claim',
    'verify.subtitle': 'Paste any text claim or image URL to run through our multi-agent verification pipeline',
    'verify.text': 'Text Claim',
    'verify.image': 'Image URL',
    'verify.btn': 'Verify with Poirot',
    'verify.hint': 'Powered by 5 AI agents • RAG • Trust Graph',
    'verify.loading': 'Agents analyzing claim...',
    'verify.confidence': 'Confidence',
    'verify.trust': 'Trust Score',
    'dash.title': 'Real-Time Intelligence Dashboard',
    'dash.subtitle': 'Live analytics on misinformation trends, verification patterns, and trust metrics',
    'dash.verdicts': 'Verdict Distribution',
    'dash.trends': 'Daily Verification Trends',
    'dash.recent': 'Recent Verifications',
    'dash.misinfo': 'Top Misinformation Detected',
    'sources.title': 'Source Credibility Leaderboard',
    'sources.subtitle': 'Trust scores computed from verification history, cross-references, and editorial standards',
    'api.title': 'Enterprise API',
    'api.subtitle': "Integrate Poirot's fact-checking intelligence into your platform",
    'table.empty': 'No verifications yet. Be the first to verify a claim!',
  },
  bn: {
    'hero.badge': 'AI-চালিত ফ্যাক্ট ইন্টেলিজেন্স',
    'hero.title1': 'সত্য যাচাই করুন।',
    'hero.title2': 'মিথ্যা তথ্য রোধ করুন।',
    'hero.subtitle': 'মাল্টি-এজেন্ট AI ইঞ্জিন — ট্রাস্ট স্কোরিং, নলেজ গ্রাফ রিজনিং, এবং রিয়েল-টাইম মিসইনফরমেশন ডিটেকশন — বাংলাদেশের জন্য তৈরি, বিশ্বব্যাপী স্কেলযোগ্য।',
    'hero.cta1': 'দাবি যাচাই করুন',
    'hero.cta2': 'ড্যাশবোর্ড দেখুন',
    'stats.total': 'যাচাই সম্পন্ন',
    'stats.false': 'মিথ্যা তথ্য শনাক্ত',
    'stats.trust': 'গড় ট্রাস্ট স্কোর',
    'stats.latency': 'গড় সময়',
    'verify.title': 'দাবি যাচাই করুন',
    'verify.subtitle': 'যেকোনো টেক্সট দাবি বা ইমেজ URL পেস্ট করুন — আমাদের মাল্টি-এজেন্ট ভেরিফিকেশন পাইপলাইন চালু হবে',
    'verify.text': 'টেক্সট দাবি',
    'verify.image': 'ইমেজ URL',
    'verify.btn': 'পয়রোট দিয়ে যাচাই',
    'verify.hint': '৫টি AI এজেন্ট • RAG • ট্রাস্ট গ্রাফ দ্বারা চালিত',
    'verify.loading': 'এজেন্টরা দাবি বিশ্লেষণ করছে...',
    'verify.confidence': 'আত্মবিশ্বাস',
    'verify.trust': 'ট্রাস্ট স্কোর',
    'dash.title': 'রিয়েল-টাইম ইন্টেলিজেন্স ড্যাশবোর্ড',
    'dash.subtitle': 'মিসইনফরমেশন ট্রেন্ড, ভেরিফিকেশন প্যাটার্ন, এবং ট্রাস্ট মেট্রিক্স',
    'dash.verdicts': 'ভার্ডিক্ট বিতরণ',
    'dash.trends': 'দৈনিক যাচাই ট্রেন্ড',
    'dash.recent': 'সাম্প্রতিক যাচাই',
    'dash.misinfo': 'শীর্ষ মিথ্যা তথ্য শনাক্ত',
    'sources.title': 'সোর্স বিশ্বাসযোগ্যতা লিডারবোর্ড',
    'sources.subtitle': 'ভেরিফিকেশন ইতিহাস, ক্রস-রেফারেন্স, এবং সম্পাদকীয় মান থেকে গণনা করা ট্রাস্ট স্কোর',
    'api.title': 'এন্টারপ্রাইজ API',
    'api.subtitle': 'আপনার প্ল্যাটফর্মে পয়রোটের ফ্যাক্ট-চেকিং ইন্টেলিজেন্স ইন্টিগ্রেট করুন',
    'table.empty': 'এখনো কোনো যাচাই নেই। প্রথম দাবি যাচাই করুন!',
  },
};

function applyLang(lang) {
  currentLang = lang;
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (i18n[lang]?.[key]) el.textContent = i18n[lang][key];
  });
}

// ── Language Toggle ────────────────────────────────────────────────────
document.getElementById('lang-toggle')?.addEventListener('click', () => {
  currentLang = currentLang === 'en' ? 'bn' : 'en';
  applyLang(currentLang);
});

// ── Navigation Active State ────────────────────────────────────────────
const sections = document.querySelectorAll('section[id]');
const navLinks = document.querySelectorAll('.nav-link[data-section]');

window.addEventListener('scroll', () => {
  let current = '';
  sections.forEach(s => {
    if (window.scrollY >= s.offsetTop - 200) current = s.id;
  });
  navLinks.forEach(l => {
    l.classList.toggle('active', l.dataset.section === current);
  });
});

// ── Fetch Dashboard Data ───────────────────────────────────────────────
async function fetchJSON(path) {
  try {
    const res = await fetch(`${API_BASE}${path}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.warn(`[API] ${path} failed:`, err.message);
    return null;
  }
}

async function loadStats() {
  const stats = await fetchJSON('/api/dashboard/stats');
  if (!stats) return;
  
  document.getElementById('stat-total').textContent = stats.total_checks || '0';
  document.getElementById('stat-false').textContent = stats.false_count || '0';
  document.getElementById('stat-trust').textContent = stats.avg_trust_score ? `${stats.avg_trust_score}%` : '—';
  document.getElementById('stat-latency').textContent = stats.avg_latency_ms ? `${(stats.avg_latency_ms / 1000).toFixed(1)}s` : '—';
}

async function loadVerdictChart() {
  const data = await fetchJSON('/api/dashboard/verdicts');
  if (!data || data.length === 0) return;
  
  const ctx = document.getElementById('chart-verdicts');
  if (!ctx) return;
  
  const colorMap = {
    'Likely True': '#22c55e',
    'Likely False': '#ef4444',
    'Uncertain': '#eab308',
    'Satirical': '#a855f7',
  };
  
  new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: data.map(d => d.verdict),
      datasets: [{
        data: data.map(d => d.count),
        backgroundColor: data.map(d => colorMap[d.verdict] || '#6366f1'),
        borderWidth: 0,
        borderRadius: 4,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { color: '#9494a8', padding: 16, font: { family: 'Inter', size: 12 } } },
      },
      cutout: '65%',
    },
  });
}

async function loadTrendsChart() {
  const data = await fetchJSON('/api/dashboard/trends');
  if (!data || data.length === 0) return;
  
  const ctx = document.getElementById('chart-trends');
  if (!ctx) return;
  
  const sorted = data.sort((a, b) => new Date(a.date) - new Date(b.date));
  
  new Chart(ctx, {
    type: 'line',
    data: {
      labels: sorted.map(d => new Date(d.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })),
      datasets: [
        {
          label: 'Total Checks',
          data: sorted.map(d => d.checks),
          borderColor: '#6366f1',
          backgroundColor: 'rgba(99, 102, 241, 0.1)',
          fill: true,
          tension: 0.4,
        },
        {
          label: 'False Claims',
          data: sorted.map(d => d.false_claims),
          borderColor: '#ef4444',
          backgroundColor: 'rgba(239, 68, 68, 0.1)',
          fill: true,
          tension: 0.4,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#5c5c70', font: { family: 'Inter' } } },
        y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#5c5c70', font: { family: 'Inter' } }, beginAtZero: true },
      },
      plugins: {
        legend: { labels: { color: '#9494a8', font: { family: 'Inter', size: 12 } } },
      },
    },
  });
}

async function loadRecentVerifications() {
  const data = await fetchJSON('/api/dashboard/recent?limit=15');
  const tbody = document.getElementById('recent-tbody');
  if (!data || !tbody) return;
  
  if (data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="table-empty">${i18n[currentLang]['table.empty']}</td></tr>`;
    return;
  }
  
  tbody.innerHTML = data.map(d => {
    const verdictClass = d.verdict?.includes('True') ? 'true' : d.verdict?.includes('False') ? 'false' : d.verdict?.includes('Satir') ? 'satirical' : 'uncertain';
    const agents = (d.agents_used || []).length;
    const time = new Date(d.created_at).toLocaleString();
    const claim = (d.claim_content || '').substring(0, 80) + ((d.claim_content || '').length > 80 ? '...' : '');
    return `<tr>
      <td><span class="badge badge-${d.claim_type === 'image' ? 'uncertain' : 'true'}">${d.claim_type}</span></td>
      <td title="${(d.claim_content || '').replace(/"/g, '&quot;')}">${claim}</td>
      <td><span class="badge badge-${verdictClass}">${d.verdict || '?'}</span></td>
      <td>${d.confidence || 0}%</td>
      <td>${d.trust_score || '—'}</td>
      <td>${agents}</td>
      <td style="font-size:11px; color:var(--text-muted)">${time}</td>
    </tr>`;
  }).join('');
}

async function loadSources() {
  const data = await fetchJSON('/api/dashboard/sources');
  const tbody = document.getElementById('sources-tbody');
  if (!data || !tbody) return;
  
  if (data.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="table-empty">Source data building...</td></tr>';
    return;
  }
  
  tbody.innerHTML = data.map((s, i) => {
    const color = s.credibility_score >= 80 ? '#22c55e' : s.credibility_score >= 50 ? '#eab308' : '#ef4444';
    return `<tr>
      <td>${i + 1}</td>
      <td><strong>${s.name || s.domain}</strong><br><span style="font-size:11px;color:var(--text-muted)">${s.domain}</span></td>
      <td>${s.category || 'unknown'}</td>
      <td>${s.bias_label || 'unknown'}</td>
      <td>
        <div class="credibility-bar"><div class="credibility-bar-fill" style="width:${s.credibility_score}%;background:${color}"></div></div>
        <strong>${s.credibility_score}</strong>
      </td>
      <td>${s.total_claims_checked || 0}</td>
    </tr>`;
  }).join('');
}

async function loadMisinfo() {
  const data = await fetchJSON('/api/dashboard/misinformation');
  const container = document.getElementById('misinfo-list');
  if (!data || !container) return;
  
  if (data.length === 0) {
    container.innerHTML = '<div class="misinfo-item"><div class="misinfo-claim">No misinformation detected yet. The system learns over time.</div></div>';
    return;
  }
  
  container.innerHTML = data.map(d => {
    const time = new Date(d.created_at).toLocaleString();
    return `<div class="misinfo-item">
      <div class="misinfo-claim">"${(d.claim_content || '').substring(0, 200)}"</div>
      <div class="misinfo-meta">
        <span>🔴 ${d.verdict}</span>
        <span>Confidence: ${d.confidence}%</span>
        <span>Trust: ${d.trust_score || '—'}</span>
        <span>${time}</span>
      </div>
    </div>`;
  }).join('');
}

// ── Verify Functionality ───────────────────────────────────────────────
let verifyType = 'text';

document.querySelectorAll('.verify-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.verify-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    verifyType = tab.dataset.type;
    const input = document.getElementById('verify-input');
    input.placeholder = verifyType === 'image' ? 'Paste image URL...' : 'Paste a claim to fact-check...';
  });
});

document.getElementById('verify-submit')?.addEventListener('click', async () => {
  const input = document.getElementById('verify-input');
  const content = input.value.trim();
  if (!content) return;
  
  const resultEl = document.getElementById('verify-result');
  const loadingEl = document.getElementById('verify-loading');
  
  resultEl.style.display = 'none';
  loadingEl.style.display = 'block';
  
  // Animate agent stages
  const agentsEl = document.getElementById('loading-agents');
  const agentStages = ['🏷️ Classifying...', '🔬 Decomposing...', '🧠 Searching knowledge base...', '⚖️ Web search + verdict synthesis...', '⚠️ Checking bias...'];
  let stageIdx = 0;
  const stageInterval = setInterval(() => {
    if (stageIdx < agentStages.length) {
      agentsEl.textContent = agentStages[stageIdx++];
    }
  }, 2000);
  
  try {
    const persona = document.getElementById('persona-select') ? document.getElementById('persona-select').value : 'General Public';

    const res = await fetch(`${API_BASE}/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: verifyType, content, persona }),
    });
    const data = await res.json();
    
    clearInterval(stageInterval);
    loadingEl.style.display = 'none';
    
    // Show result
    const verdictClass = data.verdict?.includes('True') ? 'true' : data.verdict?.includes('False') ? 'false' : data.verdict?.includes('Satir') ? 'satirical' : 'uncertain';
    
    document.getElementById('result-verdict').className = `result-verdict verdict-${verdictClass}`;
    document.getElementById('result-verdict').textContent = data.verdict || 'Unknown';
    document.getElementById('result-confidence').textContent = `${data.confidence || 0}%`;
    document.getElementById('result-trust').textContent = data.trust_score ? `${data.trust_score}%` : '—';
    document.getElementById('result-explanation').textContent = data.explanation || '';
    
    // Literacy Tip
    const literacyTipEl = document.getElementById('literacy-tip');
    const literacyTipTextEl = document.getElementById('literacy-tip-text');
    if (data.literacy_tip) {
      literacyTipTextEl.textContent = data.literacy_tip;
      literacyTipEl.style.display = 'block';
    } else {
      literacyTipEl.style.display = 'none';
    }

    // Image Forensics (removed — image fact-checking now focuses on content verification)
    const forensicsBox = document.getElementById('forensics-box');
    if (forensicsBox) forensicsBox.style.display = 'none';

    // Findings
    const findingsEl = document.getElementById('result-findings');
    if (data.key_findings?.length > 0) {
      findingsEl.innerHTML = `<h4>Key Findings</h4><ul>${data.key_findings.map(f => `<li>${f}</li>`).join('')}</ul>`;
    } else {
      findingsEl.innerHTML = '';
    }
    
    // Sources
    const sourcesEl = document.getElementById('result-sources');
    if (data.sources?.length > 0) {
      sourcesEl.innerHTML = `<h4 style="font-size:13px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px">Sources</h4>` +
        data.sources.map(s => `<a href="${s}" target="_blank">${s}</a>`).join('<br>');
    } else {
      sourcesEl.innerHTML = '';
    }
    
    // Meta
    const metaEl = document.getElementById('result-meta');
    const metaParts = [];
    if (data.agents_used) metaParts.push(`Agents: ${data.agents_used.join(' → ')}`);
    if (data.tokens_used) metaParts.push(`Tokens: ${data.tokens_used}`);
    if (data.latency_ms) metaParts.push(`Time: ${(data.latency_ms / 1000).toFixed(1)}s`);
    if (data.language) metaParts.push(`Lang: ${data.language}`);
    if (data.bias_flags?.length > 0) metaParts.push(`⚠️ Bias: ${data.bias_flags.join(', ')}`);
    metaEl.textContent = metaParts.join(' • ');
    
    resultEl.style.display = 'block';
    
    // Refresh stats
    loadStats();
    loadRecentVerifications();
  } catch (err) {
    clearInterval(stageInterval);
    loadingEl.style.display = 'none';
    resultEl.style.display = 'block';
    document.getElementById('result-verdict').className = 'result-verdict verdict-uncertain';
    document.getElementById('result-verdict').textContent = 'Error';
    document.getElementById('result-explanation').textContent = `Failed to connect: ${err.message}`;
    document.getElementById('result-findings').innerHTML = '';
    document.getElementById('result-sources').innerHTML = '';
    document.getElementById('result-meta').textContent = '';
    document.getElementById('result-confidence').textContent = '—';
    document.getElementById('result-trust').textContent = '—';
  }
});

// Allow Enter key to submit
document.getElementById('verify-input')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    document.getElementById('verify-submit').click();
  }
});

// ── Initialize ─────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadStats();
  loadVerdictChart();
  loadTrendsChart();
  loadRecentVerifications();
  loadSources();
  loadMisinfo();
  
  // Refresh every 30 seconds
  setInterval(() => {
    loadStats();
    loadRecentVerifications();
  }, 30000);
});
