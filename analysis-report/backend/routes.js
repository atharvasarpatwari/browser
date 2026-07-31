const express = require('express');
const router = express.Router();
const gitService = require('./git-service');
const fs = require('fs');
const path = require('path');

const ROOT_CAUSES_PATH = path.resolve(__dirname, '..', 'data', 'root-causes.json');
const QUALITY_PATH = path.resolve(__dirname, '..', 'data', 'quality.json');

function getRootCauses() {
  try {
    if (fs.existsSync(ROOT_CAUSES_PATH)) {
      return JSON.parse(fs.readFileSync(ROOT_CAUSES_PATH, 'utf-8'));
    }
  } catch {}
  return { open: 0, resolved: 0, critical: 0, medium: 0, low: 0 };
}

function getQuality() {
  try {
    if (fs.existsSync(QUALITY_PATH)) {
      return JSON.parse(fs.readFileSync(QUALITY_PATH, 'utf-8'));
    }
  } catch {}
  return { openIssues: 0, warnings: 0, errors: 0, duplicateCode: 0, complexity: '—', notes: [] };
}

function classifyCommit(commit) {
  const title = (commit.title || '').toLowerCase();
  const message = (commit.message || '').toLowerCase();
  const combined = title + ' ' + message;
  const files = commit.files || { modified: [], created: [] };
  const allFiles = [...(files.modified || []), ...(files.created || [])];
  const exts = allFiles.map(f => path.extname(f).toLowerCase());

  const categoryScores = {};

  if (/^plan|^todo|roadmap|proposal/i.test(title)) return 'PLAN';

  if (/\b(build|ci|cd|workflow|github.action|pipeline)\b/i.test(combined)) {
    categoryScores['CI/CD'] = (categoryScores['CI/CD'] || 0) + 3;
  }

  if (/\b(security|xss|cors|csp|csrf|sanitiz|injection|sandbox|same.origin|certif|certificate)\b/i.test(combined)) {
    categoryScores['SECURITY'] = (categoryScores['SECURITY'] || 0) + 3;
  }

  if (/\b(test|spec|jest|vitest|assert|expect|mock)\b/i.test(combined)) {
    categoryScores['TEST'] = (categoryScores['TEST'] || 0) + 2;
  }

  if (/\b(bug|fix|error|crash|issue|repair|resolve|correct)\b/i.test(combined) && !/\btest/i.test(combined)) {
    categoryScores['BUG FIX'] = (categoryScores['BUG FIX'] || 0) + 2;
  }

  if (/\b(feature|implement|add|new|support|introduce)\b/i.test(combined)) {
    categoryScores['FEATURE'] = (categoryScores['FEATURE'] || 0) + 2;
  }

  if (/\b(perform|optimize|speed|fast|slow|memory|latency|throughput)\b/i.test(combined)) {
    categoryScores['PERFORMANCE'] = (categoryScores['PERFORMANCE'] || 0) + 3;
  }

  if (/\b(refactor|clean|reorganiz|restructure|rewrite|redesign)\b/i.test(combined)) {
    categoryScores['REFACTOR'] = (categoryScores['REFACTOR'] || 0) + 3;
  }

  if (/\b(doc|readme|changelog|comment|manual|guide)\b/i.test(combined)) {
    categoryScores['DOCUMENTATION'] = (categoryScores['DOCUMENTATION'] || 0) + 2;
  }

  for (const ext of exts) {
    if (['.html', '.htm'].includes(ext)) {
      categoryScores['HTML'] = (categoryScores['HTML'] || 0) + (exts.filter(e => e === ext).length);
    }
    if (['.css', '.scss', '.less', '.sass'].includes(ext)) {
      categoryScores['CSS'] = (categoryScores['CSS'] || 0) + (exts.filter(e => e === ext).length);
    }
    if (['.js', '.jsx', '.mjs', '.cjs'].includes(ext)) {
      categoryScores['JAVASCRIPT'] = (categoryScores['JAVASCRIPT'] || 0) + (exts.filter(e => e === ext).length);
    }
    if (['.ts', '.tsx'].includes(ext)) {
      categoryScores['TYPESCRIPT'] = (categoryScores['TYPESCRIPT'] || 0) + (exts.filter(e => e === ext).length);
    }
    if (['.cpp', '.cc', '.cxx', '.c', '.h', '.hpp'].includes(ext)) {
      categoryScores['CPP'] = (categoryScores['CPP'] || 0) + (exts.filter(e => e === ext).length);
    }
    if (['.rs', '.rlib'].includes(ext)) {
      categoryScores['RUST'] = (categoryScores['RUST'] || 0) + (exts.filter(e => e === ext).length);
    }
  }

  if (Object.keys(categoryScores).length === 0) {
    return 'FEATURE';
  }

  return Object.entries(categoryScores).sort((a, b) => b[1] - a[1])[0][0];
}

let rootCausesCache = null;

function getRootCausesData() {
  if (rootCausesCache) return rootCausesCache;
  try {
    if (fs.existsSync(ROOT_CAUSES_PATH)) {
      rootCausesCache = JSON.parse(fs.readFileSync(ROOT_CAUSES_PATH, 'utf-8'));
      return rootCausesCache;
    }
  } catch {}
  return null;
}

function matchRootCause(commit) {
  const data = getRootCausesData();
  if (!data || !Array.isArray(data.recent)) return null;
  const commitDate = (commit.date || '').slice(0, 10);
  const commitFiles = new Set([
    ...(commit.files?.modified || []),
    ...(commit.files?.created || []),
    ...(commit.files?.deleted || [])
  ]);
  const title = (commit.title || '').toLowerCase();
  const message = (commit.message || '').toLowerCase();

  for (const rc of data.recent) {
    const rcDate = (rc.date || '').slice(0, 10);
    const fileHit = commitFiles.has(rc.file);
    const titleHit = rc.title && (title.includes(rc.title.toLowerCase().slice(0, 24)) || message.includes(rc.title.toLowerCase().slice(0, 24)));
    if ((fileHit || titleHit) && (!rcDate || Math.abs(new Date(commitDate) - new Date(rcDate)) < 3 * 86400000)) {
      return {
        id: rc.id,
        title: rc.title,
        severity: rc.severity,
        status: rc.status,
        file: rc.file
      };
    }
  }
  return null;
}

function determineStatus(commit) {
  const title = (commit.title || '').toLowerCase();
  const message = (commit.message || '').toLowerCase();
  const combined = title + ' ' + message;

  if (/\b(plan|todo|draft|wip)\b/i.test(combined)) return 'Planned';
  if (/\b(fix|resolve|close|complete|finish|done|merged)\b/i.test(combined)) return 'Completed';
  if (/\b(wip|progress|ongoing|working)\b/i.test(combined)) return 'In Progress';

  const now = new Date();
  const commitDate = new Date(commit.date);
  const daysDiff = (now - commitDate) / (1000 * 60 * 60 * 24);

  if (daysDiff < 7) return 'In Progress';
  if (daysDiff < 30) return 'Completed';
  return 'Completed';
}

router.get('/commits', async (req, res) => {
  try {
    const { limit = 50, offset = 0, branch, since, until, author, search } = req.query;
    const result = await gitService.getCommits({
      limit: parseInt(limit, 10),
      offset: parseInt(offset, 10),
      branch: branch || 'HEAD',
      since, until, author, search
    });
    const commits = result.commits.map(c => ({
      ...c,
      category: classifyCommit(c),
      status: determineStatus(c),
      rootCause: matchRootCause(c)
    }));
    res.json({ commits, total: result.total });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/commits/:hash', async (req, res) => {
  try {
    const result = await gitService.getCommits({ limit: 1, offset: 0, branch: req.params.hash });
    if (result.commits.length === 0) return res.status(404).json({ error: 'Commit not found' });
    const c = result.commits[0];
    c.category = classifyCommit(c);
    c.status = determineStatus(c);
    c.rootCause = matchRootCause(c);
    res.json(c);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/branches', async (req, res) => {
  try {
    const info = await gitService.getBranchInfo();
    res.json(info);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/stats', async (req, res) => {
  try {
    const [branchInfo, repoSize, todayStats, contributors, stats, testStats, fileExts] = await Promise.all([
      gitService.getBranchInfo(),
      gitService.getRepoSize(),
      gitService.getTodayStats(),
      gitService.getContributors(),
      gitService.getCommitStatistics(),
      gitService.getTestStats(),
      gitService.getFileExtensions()
    ]);

    const rootCauses = getRootCauses();
    const quality = getQuality();

    const todoCount = await gitService.runGit('grep -c "TODO" -- "*.ts" "*.js" "*.tsx" "*.jsx" "*.html" "*.css" 2>/dev/null || echo 0')
      .then(r => r.split('\n').filter(l => l.includes(':')).reduce((sum, l) => sum + parseInt(l.split(':').pop() || '0', 10), 0))
      .catch(() => 0);

    const fixmeCount = await gitService.runGit('grep -c "FIXME" -- "*.ts" "*.js" "*.tsx" "*.jsx" "*.html" "*.css" 2>/dev/null || echo 0')
      .then(r => r.split('\n').filter(l => l.includes(':')).reduce((sum, l) => sum + parseInt(l.split(':').pop() || '0', 10), 0))
      .catch(() => 0);

    res.json({
      totalCommits: stats.totalCommits,
      totalFiles: stats.totalFiles,
      todayCommits: todayStats.count,
      todayFilesChanged: todayStats.filesChanged,
      todayLinesAdded: todayStats.linesAdded,
      todayLinesRemoved: todayStats.linesRemoved,
      openBranches: branchInfo.count,
      currentBranch: branchInfo.current,
      contributors: contributors.length,
      contributorList: contributors,
      repoSize,
      testFiles: testStats.testFiles,
      estimatedTests: testStats.estimatedTests,
      fileExtensions: fileExts,
      rootCauses,
      todoCount,
      fixmeCount,
      quality
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/activity', async (req, res) => {
  try {
    const days = parseInt(req.query.days, 10) || 30;
    const activity = await gitService.getDailyActivity(days);
    res.json({ activity });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/file-extensions', async (req, res) => {
  try {
    const exts = await gitService.getFileExtensions();
    res.json({ extensions: exts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/root-causes', (req, res) => {
  res.json(getRootCauses());
});

router.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

module.exports = router;
