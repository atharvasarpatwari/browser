const API_BASE = '/api';
const COLUMNS = [
  { key: 'favorite', label: '★', sortable: true, visible: true, width: 50 },
  { key: 'date', label: 'Date', sortable: true, visible: true, width: 160 },
  { key: 'document', label: 'Document', sortable: true, visible: true, width: 280 },
  { key: 'category', label: 'Category', sortable: true, visible: true, width: 120 },
  { key: 'tests', label: 'Tests', sortable: true, visible: true, width: 80 },
  { key: 'rootCauses', label: 'Root Causes', sortable: true, visible: true, width: 120 },
  { key: 'filesModified', label: 'Files Modified', sortable: true, visible: true, width: 110 },
  { key: 'filesCreated', label: 'Files Created', sortable: true, visible: true, width: 110 },
  { key: 'status', label: 'Status', sortable: true, visible: true, width: 110 },
  { key: 'author', label: 'Author', sortable: true, visible: true, width: 140 },
  { key: 'branch', label: 'Branch', sortable: true, visible: true, width: 140 },
  { key: 'hash', label: 'Hash', sortable: true, visible: true, width: 100 },
  { key: 'linesAdded', label: '+ Lines', sortable: true, visible: true, width: 80 },
  { key: 'linesRemoved', label: '- Lines', sortable: true, visible: true, width: 80 },
];

let currentPage = 1;
let rowsPerPage = 25;
let totalCommits = 0;
let commitsData = [];
let filteredCommits = [];
let sortKey = 'date';
let sortDir = 'desc';
let favorites = JSON.parse(localStorage.getItem('ar_favorites') || '[]');
let charts = {};
let pollInterval;
let columnVisibility = JSON.parse(localStorage.getItem('ar_columns') || '{}');
let exportMenuOpen = false;
let columnMenuOpen = false;

function debounce(fn, ms) { let timer; return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); }; }
const debouncedSearch = debounce(loadCommits, 300);

async function apiFetch(path) {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

async function loadStats() {
  try {
    const stats = await apiFetch('/stats');
    const grid = document.getElementById('statsGrid');
    grid.innerHTML = '';

    const cards = [
      { value: stats.totalCommits.toLocaleString(), label: 'Total Commits', icon: '📊', accent: 'accent-blue' },
      { value: stats.todayCommits, label: "Today's Commits", icon: '📅', accent: 'accent-yellow' },
      { value: stats.totalFiles.toLocaleString(), label: 'Total Files', icon: '📁', accent: 'accent-purple' },
      { value: stats.todayFilesChanged, label: 'Files Changed Today', icon: '📝', accent: 'accent-cyan' },
      { value: stats.openBranches, label: 'Open Branches', icon: '🌿', accent: 'accent-green' },
      { value: stats.currentBranch, label: 'Current Branch', icon: '🔀', accent: 'accent-red' },
      { value: stats.contributors, label: 'Contributors', icon: '👥', accent: 'accent-purple' },
      { value: stats.repoSize, label: 'Repo Size', icon: '💾', accent: 'accent-cyan' },
      { value: stats.todayLinesAdded.toLocaleString(), label: 'Lines Added Today', icon: '➕', accent: 'accent-green' },
      { value: stats.todayLinesRemoved.toLocaleString(), label: 'Lines Removed Today', icon: '➖', accent: 'accent-red' },
      { value: stats.estimatedTests.toLocaleString(), label: 'Estimated Tests', icon: '🧪', accent: 'accent-cyan' },
      { value: stats.testFiles, label: 'Test Files', icon: '📋', accent: 'accent-blue' },
    ];

    cards.forEach(c => {
      const div = document.createElement('div');
      div.className = `stat-card ${c.accent}`;
      div.innerHTML = `<div class="stat-icon">${c.icon}</div><div class="stat-value">${c.value}</div><div class="stat-label">${c.label}</div>`;
      grid.appendChild(div);
    });

    const causes = stats.rootCauses || {};
    const rcGrid = document.getElementById('rootCausesGrid');
    if (causes.open !== undefined) {
      rcGrid.innerHTML = '';
      [
        { value: causes.open, label: 'Open', cls: 'badge-red' },
        { value: causes.resolved, label: 'Resolved', cls: 'badge-green' },
        { value: causes.critical, label: 'Critical', cls: 'badge-red' },
        { value: causes.medium, label: 'Medium', cls: 'badge-yellow' },
        { value: causes.low, label: 'Low', cls: 'badge-gray' },
      ].forEach(rc => {
        const div = document.createElement('div');
        div.className = `root-cause-item`;
        div.innerHTML = `<div class="rc-value"><span class="badge ${rc.cls}">${rc.value}</span></div><div class="rc-label">${rc.label}</div>`;
        rcGrid.appendChild(div);
      });
    }

    const q = stats.quality || {};
    const qualityGrid = document.getElementById('qualityGrid');
    qualityGrid.innerHTML = '';
    [
      { value: q.openIssues ?? 0, label: 'Open Issues', color: 'var(--accent-orange)' },
      { value: q.warnings ?? 0, label: 'Warnings', color: 'var(--accent-yellow)' },
      { value: q.errors ?? 0, label: 'Errors', color: 'var(--accent-red)' },
      { value: stats.todoCount || 0, label: 'TODO', color: 'var(--accent-yellow)' },
      { value: stats.fixmeCount || 0, label: 'FIXME', color: 'var(--accent-red)' },
      { value: q.complexity || (stats.totalCommits > 500 ? 'A' : stats.totalCommits > 100 ? 'B' : 'C'), label: 'Complexity', color: 'var(--accent-cyan)' },
      { value: q.duplicateCode != null ? `${q.duplicateCode}%` : '—', label: 'Duplicate', color: 'var(--accent-purple)' },
    ].forEach(qu => {
      const div = document.createElement('div');
      div.className = 'quality-item';
      div.innerHTML = `<div class="quality-value" style="color:${qu.color}">${qu.value}</div><div class="quality-label">${qu.label}</div>`;
      qualityGrid.appendChild(div);
    });

    const authorSelect = document.getElementById('filterAuthor');
    if (stats.contributorList) {
      const currentVal = authorSelect.value;
      authorSelect.innerHTML = '<option value="">All Authors</option>';
      stats.contributorList.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.name;
        opt.textContent = `${c.name} (${c.commits})`;
        authorSelect.appendChild(opt);
      });
      authorSelect.value = currentVal;
    }

    return stats;
  } catch (err) {
    document.getElementById('errorState').style.display = 'block';
    throw err;
  }
}

async function loadBranches() {
  try {
    const info = await apiFetch('/branches');
    const sel = document.getElementById('filterBranch');
    const cur = sel.value;
    sel.innerHTML = '<option value="">All Branches</option>';
    info.branches.forEach(b => {
      const opt = document.createElement('option');
      opt.value = b;
      opt.textContent = b;
      sel.appendChild(opt);
    });
    sel.value = cur;
  } catch {}
}

async function loadActivity() {
  try {
    const data = await apiFetch('/activity?days=30');
    renderDailyChart(data.activity);
    renderFilesChart(data.activity);
    renderWeeklyChart(data.activity);
    renderHeatmapChart(data.activity);
  } catch {}

  try {
    const stats = await apiFetch('/stats');
    if (stats.fileExtensions) renderLangChart(stats.fileExtensions);
    if (stats.contributorList) renderContributorsChart(stats.contributorList);
  } catch {}
}

async function loadCommits() {
  const category = document.getElementById('filterCategory').value;
  const status = document.getElementById('filterStatus').value;
  const author = document.getElementById('filterAuthor').value;
  const branch = document.getElementById('filterBranch').value;
  const search = document.getElementById('searchInput').value;
  const dateFrom = document.getElementById('filterDateFrom').value;
  const dateTo = document.getElementById('filterDateTo').value;

  const params = new URLSearchParams({
    limit: rowsPerPage,
    offset: (currentPage - 1) * rowsPerPage,
    search: search || '',
  });
  if (author) params.set('author', author);
  if (branch) params.set('branch', branch);
  if (dateFrom) params.set('since', `${dateFrom}T00:00:00`);
  if (dateTo) params.set('until', `${dateTo}T23:59:59`);

  document.getElementById('skeleton').style.display = 'block';
  document.getElementById('tableBody').innerHTML = '';
  document.getElementById('emptyState').style.display = 'none';
  document.getElementById('errorState').style.display = 'none';

  try {
    let result = await apiFetch(`/commits?${params}`);
    commitsData = result.commits || [];
    totalCommits = result.total || 0;

    filteredCommits = commitsData.filter(c => {
      if (category && c.category !== category) return false;
      if (status && c.status !== status) return false;
      return true;
    });

    renderTable();
    updatePagination();
    renderCategoryChart(filteredCommits);
    document.getElementById('skeleton').style.display = 'none';
  } catch (err) {
    document.getElementById('skeleton').style.display = 'none';
    document.getElementById('errorState').style.display = 'block';
  }
}

function renderTable() {
  const thead = document.getElementById('tableHead');
  const tbody = document.getElementById('tableBody');
  const visibleCols = COLUMNS.filter(c => c.visible !== false);

  thead.innerHTML = '';
  const headerRow = document.createElement('tr');
  visibleCols.forEach(col => {
    const th = document.createElement('th');
    th.setAttribute('data-key', col.key);
    th.style.width = col.width + 'px';
    th.style.minWidth = col.width + 'px';

    if (col.sortable) {
      th.style.cursor = 'pointer';
      const arrow = sortKey === col.key ? (sortDir === 'asc' ? '▲' : '▼') : '⇅';
      th.innerHTML = `${col.label} <span class="sort-icon">${arrow}</span>`;
      if (sortKey === col.key) th.classList.add('sorted');
      th.addEventListener('click', () => sortTable(col.key));
    } else {
      th.textContent = col.label;
    }

    const handle = document.createElement('div');
    handle.className = 'resize-handle';
    handle.addEventListener('mousedown', (e) => startResize(e, th));
    th.appendChild(handle);
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);

  tbody.innerHTML = '';
  if (filteredCommits.length === 0) {
    document.getElementById('emptyState').style.display = 'block';
    return;
  }

  filteredCommits.forEach((commit, idx) => {
    const tr = document.createElement('tr');
    tr.style.animationDelay = `${idx * 30}ms`;
    tr.classList.add('fade-in');

    const isFav = favorites.includes(commit.hash);

    visibleCols.forEach(col => {
      const td = document.createElement('td');
      switch (col.key) {
        case 'favorite':
          td.innerHTML = `<button class="favorite-btn ${isFav ? 'active' : ''}" onclick="toggleFavorite('${commit.hash}')">${isFav ? '★' : '☆'}</button>`;
          break;
        case 'date':
          td.textContent = formatDate(commit.date);
          break;
        case 'document':
          td.innerHTML = `<div class="commit-title" title="${escapeHtml(commit.title)}" onclick="showCommitDetail('${commit.hash}')" style="cursor:pointer">${escapeHtml(truncate(commit.title, 60))}</div>`;
          break;
        case 'category':
          td.innerHTML = categoryBadge(commit.category);
          break;
        case 'tests': {
          const testCount = countTests(commit);
          td.textContent = testCount > 0 ? testCount : '—';
          break;
        }
        case 'rootCauses': {
          const rc = commit.rootCause;
          if (rc) {
            const sevCls = { critical: 'badge-red', high: 'badge-orange', medium: 'badge-yellow', low: 'badge-gray' }[rc.severity] || 'badge-gray';
            const stCls = rc.status === 'resolved' ? 'badge-green' : 'badge-blue';
            td.innerHTML = `<span class="badge ${sevCls}" title="${escapeHtml(rc.title)}">${escapeHtml(rc.id || 'RC')}</span> <span class="badge ${stCls}">${rc.status === 'resolved' ? '✓' : '◉'}</span>`;
            td.style.whiteSpace = 'normal';
          } else {
            td.textContent = '—';
          }
          break;
        }
        case 'filesModified':
          td.textContent = (commit.files?.modified?.length || commit.filesChanged || 0);
          break;
        case 'filesCreated':
          td.textContent = (commit.files?.created?.length || 0);
          break;
        case 'status':
          td.innerHTML = statusBadge(commit.status);
          break;
        case 'author':
          td.textContent = commit.author;
          break;
        case 'branch':
          td.innerHTML = `<span class="badge badge-gray">${escapeHtml(commit.branch || '—')}</span>`;
          break;
        case 'hash':
          td.innerHTML = `<span class="commit-hash">${commit.hash?.substring(0, 8) || '—'}</span>`;
          break;
        case 'linesAdded':
          td.textContent = `+${commit.linesAdded || 0}`;
          td.style.color = 'var(--accent-green)';
          break;
        case 'linesRemoved':
          td.textContent = `-${commit.linesRemoved || 0}`;
          td.style.color = 'var(--accent-red)';
          break;
        default:
          td.textContent = '—';
      }
      tbody.appendChild(td);
    });
    tbody.appendChild(tr);
  });
}

function countTests(commit) {
  const files = commit.files || {};
  const all = [...(files.modified || []), ...(files.created || [])];
  return all.filter(f => /\.(test|spec)\.(ts|js|tsx|jsx)$/i.test(f)).length;
}

function categoryBadge(cat) {
  const colors = {
    'PLAN': 'badge-purple', 'HTML': 'badge-orange', 'CSS': 'badge-cyan',
    'JAVASCRIPT': 'badge-yellow', 'TYPESCRIPT': 'badge-blue', 'CPP': 'badge-blue',
    'RUST': 'badge-purple', 'TEST': 'badge-green', 'BUG FIX': 'badge-red',
    'FEATURE': 'badge-green', 'SECURITY': 'badge-red', 'PERFORMANCE': 'badge-cyan',
    'DOCUMENTATION': 'badge-gray', 'REFACTOR': 'badge-yellow', 'CI/CD': 'badge-pink'
  };
  const cls = colors[cat] || 'badge-gray';
  return `<span class="badge ${cls}">${escapeHtml(cat)}</span>`;
}

function statusBadge(status) {
  const colors = {
    'Planned': 'badge-yellow', 'In Progress': 'badge-blue',
    'Completed': 'badge-green', 'Failed': 'badge-red', 'Draft': 'badge-gray'
  };
  const cls = colors[status] || 'badge-gray';
  return `<span class="badge ${cls}">${escapeHtml(status || 'Unknown')}</span>`;
}

function sortTable(key) {
  if (sortKey === key) {
    sortDir = sortDir === 'asc' ? 'desc' : 'asc';
  } else {
    sortKey = key;
    sortDir = 'asc';
  }

  filteredCommits.sort((a, b) => {
    let va = getSortValue(a, key);
    let vb = getSortValue(b, key);
    if (typeof va === 'string') va = va.toLowerCase();
    if (typeof vb === 'string') vb = vb.toLowerCase();
    if (va < vb) return sortDir === 'asc' ? -1 : 1;
    if (va > vb) return sortDir === 'asc' ? 1 : -1;
    return 0;
  });
  renderTable();
}

function getSortValue(commit, key) {
  switch (key) {
    case 'date': return commit.date || '';
    case 'document': return commit.title || '';
    case 'category': return commit.category || '';
    case 'tests': return countTests(commit);
    case 'rootCauses': return commit.rootCause ? 0 : 1;
    case 'filesModified': return commit.files?.modified?.length || commit.filesChanged || 0;
    case 'filesCreated': return commit.files?.created?.length || 0;
    case 'status': return commit.status || '';
    case 'author': return commit.author || '';
    case 'branch': return commit.branch || '';
    case 'hash': return commit.hash || '';
    case 'linesAdded': return commit.linesAdded || 0;
    case 'linesRemoved': return commit.linesRemoved || 0;
    case 'favorite': return favorites.includes(commit.hash) ? 0 : 1;
    default: return 0;
  }
}

function updatePagination() {
  const totalPages = Math.max(1, Math.ceil(totalCommits / rowsPerPage));
  document.getElementById('pageInfo').textContent = `Page ${currentPage} of ${totalPages}`;
  document.getElementById('prevBtn').disabled = currentPage <= 1;
  document.getElementById('nextBtn').disabled = currentPage >= totalPages;
}

function nextPage() {
  const totalPages = Math.max(1, Math.ceil(totalCommits / rowsPerPage));
  if (currentPage < totalPages) { currentPage++; loadCommits(); }
}

function prevPage() {
  if (currentPage > 1) { currentPage--; loadCommits(); }
}

function toggleFavorite(hash) {
  const idx = favorites.indexOf(hash);
  if (idx === -1) favorites.push(hash);
  else favorites.splice(idx, 1);
  localStorage.setItem('ar_favorites', JSON.stringify(favorites));
  renderTable();
}

async function showCommitDetail(hash) {
  try {
    const commit = await apiFetch(`/commits/${encodeURIComponent(hash)}`);
    const body = document.getElementById('modalBody');
    body.innerHTML = '';
    const rows = [
      ['Hash', commit.hash],
      ['Author', commit.author],
      ['Date', formatDate(commit.date)],
      ['Branch', commit.branch],
      ['Category', commit.category],
      ['Status', commit.status],
      ['Files Changed', commit.filesChanged],
      ['Lines Added', `+${commit.linesAdded}`],
      ['Lines Removed', `-${commit.linesRemoved}`],
      ['Message', commit.message || commit.title],
    ];
    if (commit.rootCause) {
      rows.push(['Root Cause', `${commit.rootCause.id} — ${commit.rootCause.title} (${commit.rootCause.severity}, ${commit.rootCause.status})`]);
    }
    if (commit.files) {
      if (commit.files.modified?.length) rows.push(['Modified', commit.files.modified.join(', ')]);
      if (commit.files.created?.length) rows.push(['Created', commit.files.created.join(', ')]);
      if (commit.files.deleted?.length) rows.push(['Deleted', commit.files.deleted.join(', ')]);
    }
    rows.forEach(([label, value]) => {
      if (!value) return;
      const div = document.createElement('div');
      div.className = 'detail-row';
      div.innerHTML = `<span class="detail-label">${escapeHtml(label)}</span><span class="detail-value">${escapeHtml(String(value))}</span>`;
      body.appendChild(div);
    });
    document.getElementById('modalTitle').textContent = commit.title || 'Commit Details';
    document.getElementById('modalOverlay').style.display = 'flex';
  } catch {
    showToast('Failed to load commit details');
  }
}

function closeModal(e) {
  if (e && e.target !== e.currentTarget) return;
  document.getElementById('modalOverlay').style.display = 'none';
}

function renderDailyChart(activity) {
  const canvas = document.getElementById('dailyChart');
  if (!canvas || !activity?.length) return;
  const ctx = canvas.getContext('2d');
  const parent = canvas.parentElement;
  canvas.width = parent.clientWidth - 40;
  canvas.height = 200;

  const w = canvas.width, h = canvas.height;
  const pad = { top: 20, right: 10, bottom: 30, left: 40 };
  const chartW = w - pad.left - pad.right;
  const chartH = h - pad.top - pad.bottom;
  const maxVal = Math.max(...activity.map(a => a.count), 1);
  const barW = Math.max(4, chartW / activity.length - 2);

  ctx.clearRect(0, 0, w, h);

  const grad = ctx.createLinearGradient(0, pad.top, 0, pad.top + chartH);
  grad.addColorStop(0, 'rgba(59,130,246,0.8)');
  grad.addColorStop(1, 'rgba(6,182,212,0.2)');

  activity.forEach((a, i) => {
    const x = pad.left + (chartW / activity.length) * i;
    const barH = (a.count / maxVal) * chartH;
    const y = pad.top + chartH - barH;

    ctx.fillStyle = grad;
    ctx.beginPath();
    const r = Math.min(3, barW / 2);
    ctx.roundRect(x, y, barW - 2, barH, [r, r, 0, 0]);
    ctx.fill();

    if (a.count > 0) {
      ctx.fillStyle = 'var(--text-muted)';
      ctx.font = '8px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(a.count, x + barW / 2, y - 3);
    }

    if (i % 5 === 0 || i === activity.length - 1) {
      ctx.fillStyle = 'var(--text-muted)';
      ctx.font = '8px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(a.date.slice(5), x + barW / 2, h - 5);
    }
  });

  ctx.strokeStyle = 'var(--border-glass)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad.left, pad.top);
  ctx.lineTo(pad.left, pad.top + chartH);
  ctx.lineTo(pad.left + chartW, pad.top + chartH);
  ctx.stroke();

  ctx.fillStyle = 'var(--text-muted)';
  ctx.font = '9px sans-serif';
  ctx.textAlign = 'right';
  for (let v = 0; v <= maxVal; v += Math.max(1, Math.ceil(maxVal / 4))) {
    const y = pad.top + chartH - (v / maxVal) * chartH;
    ctx.fillText(v, pad.left - 5, y + 3);
  }
}

function renderCategoryChart(commits) {
  const canvas = document.getElementById('categoryChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const parent = canvas.parentElement;
  canvas.width = parent.clientWidth - 40;
  canvas.height = 200;

  const w = canvas.width, h = canvas.height;
  const cats = {};
  commits.forEach(c => { const cat = c.category || 'OTHER'; cats[cat] = (cats[cat] || 0) + 1; });
  const entries = Object.entries(cats).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((s, e) => s + e[1], 0);
  if (total === 0) return;

  const colors = {
    'PLAN': '#8b5cf6', 'HTML': '#f97316', 'CSS': '#06b6d4', 'JAVASCRIPT': '#eab308',
    'TYPESCRIPT': '#3b82f6', 'CPP': '#3b82f6', 'RUST': '#8b5cf6', 'TEST': '#22c55e',
    'BUG FIX': '#ef4444', 'FEATURE': '#22c55e', 'SECURITY': '#ef4444',
    'PERFORMANCE': '#06b6d4', 'DOCUMENTATION': '#64748b', 'REFACTOR': '#eab308',
    'CI/CD': '#ec4899', 'OTHER': '#94a3b8'
  };

  const cx = w / 2, cy = h / 2 + 10, radius = Math.min(cx, cy) - 20;

  let startAngle = -Math.PI / 2;
  entries.forEach(([cat, count]) => {
    const slice = (count / total) * 2 * Math.PI;
    const endAngle = startAngle + slice;

    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, radius, startAngle, endAngle);
    ctx.closePath();
    ctx.fillStyle = colors[cat] || '#94a3b8';
    ctx.fill();

    const mid = startAngle + slice / 2;
    const labelR = radius * 0.65;
    const lx = cx + Math.cos(mid) * labelR;
    const ly = cy + Math.sin(mid) * labelR;

    if (slice > 0.2) {
      ctx.fillStyle = '#fff';
      ctx.font = '9px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${cat}`, lx, ly);
    }

    startAngle = endAngle;
  });

  ctx.fillStyle = 'var(--text-muted)';
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(`${entries.length} categories`, cx, h - 5);

  let legendX = 10;
  ctx.textAlign = 'left';
  entries.slice(0, 5).forEach(([cat, count]) => {
    ctx.fillStyle = colors[cat] || '#94a3b8';
    ctx.fillRect(legendX, h - 22, 8, 8);
    ctx.fillStyle = 'var(--text-muted)';
    ctx.font = '8px sans-serif';
    ctx.fillText(`${cat}(${count})`, legendX + 12, h - 15);
    legendX += ctx.measureText(`${cat}(${count})`).width + 20;
  });
}

function renderFilesChart(activity) {
  const canvas = document.getElementById('filesChart');
  if (!canvas || !activity?.length) return;
  const ctx = canvas.getContext('2d');
  const parent = canvas.parentElement;
  canvas.width = parent.clientWidth - 40;
  canvas.height = 200;

  const w = canvas.width, h = canvas.height;
  const pad = { top: 20, right: 10, bottom: 30, left: 40 };
  const chartW = w - pad.left - pad.right;
  const chartH = h - pad.top - pad.bottom;
  const maxVal = Math.max(...activity.map(a => a.count), 1);

  ctx.clearRect(0, 0, w, h);

  const grad = ctx.createLinearGradient(0, pad.top, 0, pad.top + chartH);
  grad.addColorStop(0, 'rgba(34,197,94,0.6)');
  grad.addColorStop(1, 'rgba(34,197,94,0.05)');

  ctx.beginPath();
  activity.forEach((a, i) => {
    const x = pad.left + (chartW / activity.length) * i;
    const y = pad.top + chartH - (a.count / maxVal) * chartH;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.lineTo(pad.left + chartW, pad.top + chartH);
  ctx.lineTo(pad.left, pad.top + chartH);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  ctx.strokeStyle = 'rgba(34,197,94,0.8)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  activity.forEach((a, i) => {
    const x = pad.left + (chartW / activity.length) * i;
    const y = pad.top + chartH - (a.count / maxVal) * chartH;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.stroke();

  ctx.strokeStyle = 'var(--border-glass)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad.left, pad.top);
  ctx.lineTo(pad.left, pad.top + chartH);
  ctx.lineTo(pad.left + chartW, pad.top + chartH);
  ctx.stroke();

  ctx.fillStyle = 'var(--text-muted)';
  ctx.font = '9px sans-serif';
  ctx.textAlign = 'right';
  for (let v = 0; v <= maxVal; v += Math.max(1, Math.ceil(maxVal / 4))) {
    const y = pad.top + chartH - (v / maxVal) * chartH;
    ctx.fillText(v, pad.left - 5, y + 3);
  }

  ctx.font = '8px sans-serif';
  ctx.textAlign = 'center';
  for (let i = 0; i < activity.length; i += Math.max(1, Math.floor(activity.length / 10))) {
    const x = pad.left + (chartW / activity.length) * i;
    ctx.fillText(activity[i].date.slice(5), x, h - 5);
  }
}

function renderLangChart(extensions) {
  const canvas = document.getElementById('langChart');
  if (!canvas || !extensions?.length) return;
  const ctx = canvas.getContext('2d');
  const parent = canvas.parentElement;
  canvas.width = parent.clientWidth - 40;
  canvas.height = 200;

  const w = canvas.width, h = canvas.height;
  const topExts = extensions.slice(0, 10);
  const total = topExts.reduce((s, e) => s + e.count, 0);
  const maxCount = Math.max(...topExts.map(e => e.count), 1);

  const colors = [
    '#3b82f6', '#eab308', '#22c55e', '#ef4444', '#8b5cf6',
    '#06b6d4', '#f97316', '#ec4899', '#64748b', '#14b8a6'
  ];

  const pad = { top: 10, right: 10, bottom: 20, left: 80 };
  const chartW = w - pad.left - pad.right;
  const chartH = h - pad.top - pad.bottom;

  ctx.clearRect(0, 0, w, h);

  topExts.forEach((e, i) => {
    const barW = (e.count / maxCount) * chartW;
    const y = pad.top + (chartH / topExts.length) * i + 4;
    const barH = Math.max(6, chartH / topExts.length - 4);

    const grad = ctx.createLinearGradient(pad.left, 0, pad.left + chartW, 0);
    grad.addColorStop(0, colors[i % colors.length]);
    grad.addColorStop(1, colors[i % colors.length] + '40');
    ctx.fillStyle = grad;

    const r = Math.min(4, barH / 2);
    ctx.beginPath();
    ctx.roundRect(pad.left, y, barW, barH, r);
    ctx.fill();

    ctx.fillStyle = 'var(--text-primary)';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    const label = e.ext || '(none)';
    ctx.fillText(label, pad.left - 8, y + barH / 2);

    if (barW > 40) {
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.font = '9px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(`${e.count}`, pad.left + 6, y + barH / 2);
    }
  });
}

function renderWeeklyChart(activity) {
  const canvas = document.getElementById('weeklyChart');
  if (!canvas || !activity?.length) return;
  const ctx = canvas.getContext('2d');
  const parent = canvas.parentElement;
  canvas.width = parent.clientWidth - 40;
  canvas.height = 200;

  const w = canvas.width, h = canvas.height;
  const pad = { top: 20, right: 10, bottom: 30, left: 40 };
  const chartW = w - pad.left - pad.right;
  const chartH = h - pad.top - pad.bottom;

  const weeks = [];
  const weekMap = {};
  activity.forEach(a => {
    const d = new Date(a.date + 'T00:00:00');
    const iso = new Date(d.getTime() - ((d.getDay() + 6) % 7) * 86400000);
    const key = iso.toISOString().slice(0, 10);
    if (!weekMap[key]) {
      weekMap[key] = { label: key.slice(5), count: 0 };
      weeks.push(weekMap[key]);
    }
    weekMap[key].count += a.count;
  });

  const maxVal = Math.max(...weeks.map(wd => wd.count), 1);
  const step = chartW / Math.max(1, weeks.length);

  ctx.clearRect(0, 0, w, h);

  weeks.forEach((wd, i) => {
    const x = pad.left + step * i;
    const barH = (wd.count / maxVal) * chartH;
    const y = pad.top + chartH - barH;

    const grad = ctx.createLinearGradient(0, pad.top, 0, pad.top + chartH);
    grad.addColorStop(0, 'rgba(139,92,246,0.85)');
    grad.addColorStop(1, 'rgba(236,72,153,0.25)');
    ctx.fillStyle = grad;
    const r = Math.min(3, step / 4);
    ctx.beginPath();
    ctx.roundRect(x + 2, y, step - 4, barH, [r, r, 0, 0]);
    ctx.fill();

    ctx.fillStyle = 'var(--text-muted)';
    ctx.font = '8px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(wd.label, x + step / 2, h - 5);
  });

  ctx.strokeStyle = 'var(--border-glass)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad.left, pad.top);
  ctx.lineTo(pad.left, pad.top + chartH);
  ctx.lineTo(pad.left + chartW, pad.top + chartH);
  ctx.stroke();

  ctx.fillStyle = 'var(--text-muted)';
  ctx.font = '9px sans-serif';
  ctx.textAlign = 'right';
  for (let v = 0; v <= maxVal; v += Math.max(1, Math.ceil(maxVal / 4))) {
    const y = pad.top + chartH - (v / maxVal) * chartH;
    ctx.fillText(v, pad.left - 5, y + 3);
  }
}

function renderContributorsChart(contributors) {
  const canvas = document.getElementById('contributorsChart');
  if (!canvas || !contributors?.length) return;
  const ctx = canvas.getContext('2d');
  const parent = canvas.parentElement;
  canvas.width = parent.clientWidth - 40;
  canvas.height = 200;

  const w = canvas.width, h = canvas.height;
  const pad = { top: 10, right: 60, bottom: 10, left: 10 };
  const chartW = w - pad.left - pad.right;
  const chartH = h - pad.top - pad.bottom;
  const top = contributors.slice(0, 8);
  const maxCommits = Math.max(...top.map(c => c.commits), 1);

  const colors = ['#3b82f6', '#06b6d4', '#8b5cf6', '#ec4899', '#eab308', '#22c55e', '#f97316', '#ef4444'];

  ctx.clearRect(0, 0, w, h);

  top.forEach((c, i) => {
    const barW = (c.commits / maxCommits) * chartW;
    const y = pad.top + (chartH / top.length) * i + 4;
    const barH = Math.max(8, chartH / top.length - 4);

    const grad = ctx.createLinearGradient(pad.left, 0, pad.left + chartW, 0);
    const base = colors[i % colors.length];
    grad.addColorStop(0, base);
    grad.addColorStop(1, base + '30');
    ctx.fillStyle = grad;
    const r = Math.min(4, barH / 2);
    ctx.beginPath();
    ctx.roundRect(pad.left, y, barW, barH, r);
    ctx.fill();

    ctx.fillStyle = 'var(--text-muted)';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const name = c.name.length > 18 ? c.name.slice(0, 18) + '…' : c.name;
    ctx.fillText(name, pad.left + barW + 6, y + barH / 2);

    if (barW > 60) {
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.font = '9px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(String(c.commits), pad.left + 6, y + barH / 2);
    }
  });
}

function renderHeatmapChart(activity) {
  const canvas = document.getElementById('heatmapChart');
  if (!canvas || !activity?.length) return;
  const ctx = canvas.getContext('2d');
  const parent = canvas.parentElement;
  canvas.width = parent.clientWidth - 40;
  canvas.height = 200;

  const w = canvas.width, h = canvas.height;
  const pad = { top: 16, right: 10, bottom: 16, left: 34 };

  const dayLabels = ['', 'Mon', '', 'Wed', '', 'Fri', ''];
  const weeks = [];
  let currentWeek = [];
  activity.forEach(a => {
    const d = new Date(a.date + 'T00:00:00');
    const day = (d.getDay() + 6) % 7;
    if (day === 0 && currentWeek.length > 0) {
      weeks.push(currentWeek);
      currentWeek = [];
    }
    currentWeek.push({ day, count: a.count });
  });
  if (currentWeek.length > 0) weeks.push(currentWeek);

  const cols = weeks.length;
  const cellW = Math.min(18, (w - pad.left - pad.right) / cols);
  const cellH = Math.min(18, (h - pad.top - pad.bottom) / 7);
  const maxCount = Math.max(...activity.map(a => a.count), 1);

  ctx.clearRect(0, 0, w, h);

  weeks.forEach((week, wi) => {
    week.forEach(d => {
      const x = pad.left + wi * cellW;
      const y = pad.top + d.day * cellH;
      const intensity = d.count / maxCount;
      const alpha = 0.08 + intensity * 0.9;
      ctx.fillStyle = `rgba(59,130,246,${alpha})`;
      ctx.beginPath();
      ctx.roundRect(x + 1, y + 1, cellW - 2, cellH - 2, 3);
      ctx.fill();
      if (intensity > 0.7) {
        ctx.fillStyle = '#fff';
        ctx.font = '8px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(d.count), x + cellW / 2, y + cellH / 2);
      }
    });
  });

  ctx.fillStyle = 'var(--text-muted)';
  ctx.font = '9px sans-serif';
  ctx.textAlign = 'right';
  dayLabels.forEach((l, i) => {
    if (l) ctx.fillText(l, pad.left - 5, pad.top + i * cellH + cellH / 2 + 3);
  });

  ctx.font = '10px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(`${activity.length} days · max ${maxCount} commits/day`, w / 2, h - 2);
}

function startResize(e, th) {
  e.preventDefault();
  const startX = e.clientX;
  const startW = th.offsetWidth;

  function onMove(ev) {
    const newW = Math.max(40, startW + (ev.clientX - startX));
    th.style.width = newW + 'px';
    th.style.minWidth = newW + 'px';
  }

  function onUp() {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
  }

  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

function toggleExportMenu() {
  exportMenuOpen = !exportMenuOpen;
  document.getElementById('exportMenu').style.display = exportMenuOpen ? 'block' : 'none';
  if (exportMenuOpen) columnMenuOpen = false;
  document.getElementById('columnMenu').style.display = 'none';
}

function toggleColumnMenu() {
  columnMenuOpen = !columnMenuOpen;
  const menu = document.getElementById('columnMenu');
  menu.style.display = columnMenuOpen ? 'block' : 'none';
  if (columnMenuOpen) {
    exportMenuOpen = false;
    document.getElementById('exportMenu').style.display = 'none';
    renderColumnMenu();
  }
}

function renderColumnMenu() {
  const menu = document.getElementById('columnMenu');
  menu.innerHTML = '';
  COLUMNS.forEach(col => {
    if (col.key === 'favorite') return;
    const label = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = col.visible !== false;
    cb.dataset.key = col.key;
    cb.addEventListener('change', () => {
      col.visible = cb.checked;
      localStorage.setItem('ar_columns', JSON.stringify(columnVisibility));
      renderTable();
    });
    label.appendChild(cb);
    label.appendChild(document.createTextNode(' ' + col.label));
    menu.appendChild(label);
  });
}

function exportCSV() {
  const rows = [['Favorite', 'Date', 'Document', 'Category', 'Tests', 'Root Cause', 'Files Modified', 'Files Created', 'Status', 'Author', 'Branch', 'Hash']];
  filteredCommits.forEach(c => {
    rows.push([
      favorites.includes(c.hash) ? 'Yes' : 'No',
      c.date || '',
      `"${(c.title || '').replace(/"/g, '""')}"`,
      c.category || '',
      countTests(c),
      c.rootCause ? `${c.rootCause.id} ${c.rootCause.title}` : '—',
      c.files?.modified?.length || c.filesChanged || 0,
      c.files?.created?.length || 0,
      c.status || '',
      c.author || '',
      c.branch || '',
      c.hash || ''
    ]);
  });
  const csv = rows.map(r => r.join(',')).join('\n');
  downloadFile(csv, 'analysis-report.csv', 'text/csv');
  showToast('CSV exported');
  toggleExportMenu();
}

function exportJSON() {
  const data = filteredCommits.map(c => ({
    hash: c.hash, author: c.author, date: c.date, title: c.title,
    category: c.category, status: c.status, branch: c.branch,
    filesChanged: c.filesChanged, linesAdded: c.linesAdded, linesRemoved: c.linesRemoved,
    favorite: favorites.includes(c.hash)
  }));
  downloadFile(JSON.stringify(data, null, 2), 'analysis-report.json', 'application/json');
  showToast('JSON exported');
  toggleExportMenu();
}

function exportExcel() {
  const rows = [['Favorite', 'Date', 'Document', 'Category', 'Tests', 'Root Cause', 'Files Modified', 'Files Created', 'Status', 'Author', 'Branch', 'Hash', 'Lines Added', 'Lines Removed']];
  filteredCommits.forEach(c => {
    rows.push([
      favorites.includes(c.hash) ? 'Yes' : 'No',
      c.date || '',
      c.title || '',
      c.category || '',
      countTests(c),
      c.rootCause ? `${c.rootCause.id} ${c.rootCause.title}` : '—',
      c.files?.modified?.length || c.filesChanged || 0,
      c.files?.created?.length || 0,
      c.status || '',
      c.author || '',
      c.branch || '',
      c.hash || '',
      c.linesAdded || 0,
      c.linesRemoved || 0
    ]);
  });
  const xml = buildSpreadsheetML(rows);
  downloadFile(xml, 'analysis-report.xls', 'application/vnd.ms-excel');
  showToast('Excel exported');
  toggleExportMenu();
}

function buildSpreadsheetML(rows) {
  const cells = (row, rowIdx) => row.map((val, ci) => {
    const isNum = typeof val === 'number';
    const dataType = isNum ? 'Number' : 'String';
    const safeVal = String(val).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `<Cell ss:Index="${ci + 1}" ss:StyleID="${rowIdx === 0 ? 'Header' : 'Default'}"><Data ss:Type="${dataType}">${safeVal}</Data></Cell>`;
  }).join('');

  const body = rows.map((row, i) =>
    `<Row>${cells(row, i)}</Row>`
  ).join('');

  return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
 <Styles>
  <Style ss:ID="Default" ss:Name="Normal">
   <Alignment ss:Vertical="Center"/>
   <Font ss:FontName="Calibri" ss:Size="11"/>
  </Style>
  <Style ss:ID="Header">
   <Alignment ss:Horizontal="Center" ss:Vertical="Center"/>
   <Font ss:FontName="Calibri" ss:Size="11" ss:Bold="1"/>
   <Interior ss:Color="#3B82F6" ss:Pattern="Solid"/>
  </Style>
 </Styles>
 <Worksheet ss:Name="Analysis Report">
  <Table>
   ${body}
  </Table>
 </Worksheet>
</Workbook>`;
}

function downloadFile(content, filename, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function toggleTheme() {
  const html = document.documentElement;
  const isDark = html.getAttribute('data-theme') !== 'light';
  html.setAttribute('data-theme', isDark ? 'light' : 'dark');
  document.getElementById('themeToggle').innerHTML = isDark ? '&#9790;' : '&#9788;';
  localStorage.setItem('ar_theme', isDark ? 'light' : 'dark');
}

function toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(() => {});
  } else {
    document.exitFullscreen().catch(() => {});
  }
}

function showToast(msg) {
  const old = document.querySelector('.toast');
  if (old) old.remove();
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2500);
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
    ' ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

function truncate(str, len) {
  return str?.length > len ? str.substring(0, len) + '…' : str;
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('.export-menu')) {
    document.getElementById('exportMenu').style.display = 'none';
    exportMenuOpen = false;
  }
  if (!e.target.closest('.column-toggle-menu')) {
    document.getElementById('columnMenu').style.display = 'none';
    columnMenuOpen = false;
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'f' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    document.getElementById('searchInput').focus();
  }
  if (e.key === 'Escape') closeModal();
  if (e.key === 'r' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    loadAll();
  }
});

async function loadAll() {
  try {
    await Promise.all([loadStats(), loadBranches(), loadCommits(), loadActivity()]);
  } catch (err) {
    console.error('Failed to load data:', err);
  }
}

loadAll();

pollInterval = setInterval(async () => {
  try {
    const health = await fetch(`${API_BASE}/health`).then(r => r.json());
    if (health.status === 'ok') {
      loadAll();
    }
  } catch {}
}, 10000);
