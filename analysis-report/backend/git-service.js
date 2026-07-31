const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

const REPO_PATH = path.resolve(__dirname, '..', '..');

function runGit(args) {
  return new Promise((resolve, reject) => {
    exec(`git ${args}`, { cwd: REPO_PATH, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(stderr || err.message));
        return;
      }
      resolve(stdout.trim());
    });
  });
}

function parseLogLine(line) {
  const parts = line.split('\t');
  if (parts.length < 7) return null;
  const [hash, author, date, branch, filesChanged, linesAdded, linesRemoved, ...rest] = parts;
  const title = rest.join('\t') || 'No title';
  return {
    hash,
    author,
    date,
    branch: branch || 'unknown',
    filesChanged: parseInt(filesChanged, 10) || 0,
    linesAdded: parseInt(linesAdded, 10) || 0,
    linesRemoved: parseInt(linesRemoved, 10) || 0,
    title
  };
}

async function getCommits(options = {}) {
  const { limit = 100, offset = 0, branch = 'HEAD', since, until, author, search } = options;

  const RS = '\x1e';
  let logArgs = `log --no-merges --format="${RS}%H|%an|%ai|%D|%s" --shortstat ${branch}`;
  if (since) logArgs += ` --since="${since}"`;
  if (until) logArgs += ` --until="${until}"`;
  if (author) logArgs += ` --author="${author}"`;

  try {
    const rawLog = await runGit(logArgs);
    if (!rawLog) return { commits: [], total: 0 };

    const allCommits = [];
    const blocks = rawLog.split(RS).filter(b => b.trim());

    for (const block of blocks) {
      const lines = block.split('\n').filter(l => l.trim());
      const headerLine = lines[0];
      const statLine = lines.slice(1).join(' ');

      const parts = headerLine.split('|');
      if (parts.length < 5) continue;

      const hash = parts[0];
      const author = parts[1];
      const date = parts[2];
      const branchInfo = parts[3];
      const fullTitle = parts[4];

      let filesChanged = 0, linesAdded = 0, linesRemoved = 0;
      const statMatch = statLine.match(/(\d+) file[s]? changed/);
      if (statMatch) filesChanged = parseInt(statMatch[1], 10);
      const addedMatch = statLine.match(/(\d+) insertion[s]?\(\+\)/);
      if (addedMatch) linesAdded = parseInt(addedMatch[1], 10);
      const removedMatch = statLine.match(/(\d+) deletion[s]?\(\-\)/);
      if (removedMatch) linesRemoved = parseInt(removedMatch[1], 10);

      allCommits.push({
        hash,
        author,
        date,
        branch: branchInfo.split(',')[0]?.trim() || 'unknown',
        title: fullTitle,
        message: fullTitle,
        filesChanged,
        linesAdded,
        linesRemoved
      });
    }

    const filtered = allCommits.filter(c => {
      if (search) {
        const q = search.toLowerCase();
        return c.title.toLowerCase().includes(q) ||
               c.author.toLowerCase().includes(q) ||
               c.message.toLowerCase().includes(q) ||
               c.branch.toLowerCase().includes(q) ||
               c.hash.toLowerCase().includes(q);
      }
      return true;
    });

    const total = filtered.length;
    const commits = filtered.slice(offset, offset + limit);

    for (const c of commits) {
      await enrichCommit(c);
    }

    return { commits, total };
  } catch (err) {
    return { commits: [], total: 0, error: err.message };
  }
}

async function enrichCommit(commit) {
  try {
    const diffTree = await runGit(`diff-tree --no-commit-id -r --name-status -C -M ${commit.hash}`);
    if (diffTree) {
      const lines = diffTree.split('\n').filter(l => l.trim());
      const modified = [];
      const created = [];
      const deleted = [];
      for (const line of lines) {
        const [status, ...fileParts] = line.split('\t');
        const file = fileParts.join('\t');
        if (status === 'M' || status === 'R100' || status === 'R') modified.push(file);
        else if (status === 'A') created.push(file);
        else if (status === 'D') deleted.push(file);
        else modified.push(file);
      }
      commit.files = { modified, created, deleted };
    }
  } catch (e) {
    commit.files = { modified: [], created: [], deleted: [] };
  }
}

async function getBranchInfo() {
  try {
    const current = await runGit('branch --show-current');
    const all = await runGit('branch -a');
    const branches = all.split('\n').filter(Boolean).map(b => b.trim().replace(/^\*\s*/, ''));
    const count = branches.length;
    return { current, branches, count };
  } catch {
    return { current: 'unknown', branches: [], count: 0 };
  }
}

async function getRepoSize() {
  try {
    const size = await runGit('count-objects -v');
    const match = size.match(/size-pack:\s+(\d+)/);
    if (match) {
      const kb = parseInt(match[1], 10);
      return (kb / 1024).toFixed(2) + ' MB';
    }
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

async function getTodayStats() {
  const today = new Date();
  const dateStr = today.toISOString().split('T')[0];
  try {
    const log = await runGit(`log --oneline --no-merges --after="${dateStr}T00:00:00" --before="${dateStr}T23:59:59" --format="%H"`);
    const commits = log.split('\n').filter(Boolean);
    let added = 0, removed = 0, files = 0;
    for (const hash of commits) {
      try {
        const stat = await runGit(`diff-tree --no-commit-id -r --shortstat ${hash}`);
        const m = stat.match(/(\d+) file[s]? changed/);
        if (m) files += parseInt(m[1], 10);
        const a = stat.match(/(\d+) insertion/);
        if (a) added += parseInt(a[1], 10);
        const r = stat.match(/(\d+) deletion/);
        if (r) removed += parseInt(r[1], 10);
      } catch {}
    }
    return { count: commits.length, filesChanged: files, linesAdded: added, linesRemoved: removed };
  } catch {
    return { count: 0, filesChanged: 0, linesAdded: 0, linesRemoved: 0 };
  }
}

async function getContributors() {
  try {
    const log = await runGit('shortlog -s -n --all');
    return log.split('\n').filter(Boolean).map(line => {
      const match = line.trim().match(/^(\d+)\s+(.+)$/);
      return match ? { commits: parseInt(match[1], 10), name: match[2] } : null;
    }).filter(Boolean);
  } catch {
    return [];
  }
}

async function getDailyActivity(days = 30) {
  const activity = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split('T')[0];
    try {
      const count = await runGit(`rev-list --count --after="${dateStr}T00:00:00" --before="${dateStr}T23:59:59" HEAD`);
      activity.push({ date: dateStr, count: parseInt(count, 10) || 0 });
    } catch {
      activity.push({ date: dateStr, count: 0 });
    }
  }
  return activity;
}

async function getFileExtensions() {
  try {
    const files = await runGit('ls-files');
    const exts = {};
    files.split('\n').filter(Boolean).forEach(f => {
      const ext = path.extname(f).toLowerCase() || '(no ext)';
      exts[ext] = (exts[ext] || 0) + 1;
    });
    return Object.entries(exts)
      .map(([ext, count]) => ({ ext, count }))
      .sort((a, b) => b.count - a.count);
  } catch {
    return [];
  }
}

async function getCommitStatistics() {
  const total = await runGit('rev-list --count HEAD').catch(() => '0');
  const fileCount = await runGit('ls-files').then(f => f.split('\n').filter(Boolean).length).catch(() => 0);
  return {
    totalCommits: parseInt(total, 10) || 0,
    totalFiles: fileCount
  };
}

async function getTestStats() {
  try {
    const testFiles = await runGit('ls-files -- "*.test.*" "*.spec.*" "__tests__/**" "tests/**"');
    const testFilesList = testFiles.split('\n').filter(Boolean);
    const total = testFilesList.length;
    let testLines = 0;
    for (const tf of testFilesList.slice(0, 50)) {
      try {
        const content = await runGit(`show HEAD:${tf}`);
        const testMatches = content.match(/\b(test|it|describe)\s*\(/g);
        if (testMatches) testLines += testMatches.length;
      } catch {}
    }
    return { testFiles: total, estimatedTests: testLines };
  } catch {
    return { testFiles: 0, estimatedTests: 0 };
  }
}

module.exports = {
  getCommits,
  getBranchInfo,
  getRepoSize,
  getTodayStats,
  getContributors,
  getDailyActivity,
  getFileExtensions,
  getCommitStatistics,
  getTestStats,
  runGit
};
