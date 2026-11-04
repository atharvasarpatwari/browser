"""
Builds the Root Cause Tracker section of doc/analytics.html from the Nova Android change logs.

Every `### N. <title>` under a `## Root Causes` heading in doc/*nova-android*.md becomes one row:
version (from the file name or the title), date, the problem, the fix and the change log. The block
lives between marker comments, so rerunning replaces it; the first run inserts it before the to-do
section. Usage: python root_cause_tracker.py <doc dir> <analytics.html> [<analytics.html> …]
"""
import html, json, os, re, sys

START, END = '<!-- ROOT-CAUSE-TRACKER:START -->', '<!-- ROOT-CAUSE-TRACKER:END -->'

def clean(text: str, limit: int) -> str:
    text = re.sub(r'```.*?```', ' ', text, flags=re.S)
    text = re.sub(r'\*\*|`', '', text)
    text = re.sub(r'\[([^\]]+)\]\([^)]+\)', r'\1', text)
    text = re.sub(r'^\s*[-*]\s+', '', text, flags=re.M)
    text = re.sub(r'\s+', ' ', text).strip()
    return text if len(text) <= limit else text[:limit - 1].rstrip() + '…'

def field(body: str, name: str) -> str:
    m = re.search(r'\*\*' + name + r':\*\*(.*?)(?=\n\*\*[A-Z][A-Za-z ]+:\*\*|\n### |\n## |\Z)', body, re.S)
    return clean(m.group(1), 360) if m else ''

def entries(doc_dir: str):
    rows = []
    for name in sorted(os.listdir(doc_dir)):
        if 'nova-android' not in name or not name.endswith('.md'):
            continue
        text = open(os.path.join(doc_dir, name), encoding='utf8').read()
        sec = re.search(r'^## Root Causes?.*?$(.*?)(?=^## (?!#)|\Z)', text, re.S | re.M)
        if not sec:
            continue
        ver = re.search(r'nova-android-(\d+\.\d+(?:-\d+\.\d+)?)', name)
        for m in re.finditer(r'^### (\d+)\.\s*(.+?)$(.*?)(?=^### |\Z)', sec.group(1), re.S | re.M):
            title, body = m.group(2).strip(), m.group(3)
            tv = re.search(r'\((\d\.\d+)\)\s*$', title)
            rows.append({
                'v': tv.group(1) if tv else (ver.group(1) if ver else ''),
                'd': name[:10],
                't': clean(title, 160),
                'p': field(body, 'Problem'),
                'f': field(body, 'Fix'),
                'doc': name,
            })
    return rows

def block(rows) -> str:
    # Every '<' escaped: titles quote markup (`<script>`, `</button>`), which must not end or confuse the data block.
    data = json.dumps(rows, ensure_ascii=False).replace('<', '\\u003c')
    return f'''{START}
<div class="insights-card glass" id="rootCauseTracker">
  <h3>🐞 Root Cause Tracker — Nova Android</h3>
  <div class="todo-sub">Every bug fixed in the Android app, with the cause found and the fix made. Generated from the change logs' Root Causes sections; filter by version, symptom, cause or file.</div>
  <div class="todo-input-row">
    <input type="search" id="rcFilter" placeholder="Filter root causes (e.g. 1.77, grid, popstate)" style="flex:1;min-width:0;padding:8px 10px;border-radius:8px;border:1px solid var(--border, #444);background:transparent;color:inherit">
    <span id="rcCount" style="align-self:center;white-space:nowrap"></span>
  </div>
  <div class="table-scroll table-scroll--tall">
    <table class="leader-table" id="rcTable">
      <thead><tr><th>Version</th><th>Date</th><th>Root cause</th><th>Problem</th><th>Fix</th><th>Change log</th></tr></thead>
      <tbody id="rcBody"></tbody>
    </table>
  </div>
</div>
<script type="application/json" id="rcData">{data}</script>
<script>
(function(){{
  var rows=[];try{{rows=JSON.parse(document.getElementById('rcData').textContent)}}catch(e){{return}}
  var body=document.getElementById('rcBody'),count=document.getElementById('rcCount'),input=document.getElementById('rcFilter');
  function esc(s){{return String(s).replace(/[&<>"]/g,function(c){{return {{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}}[c]}})}}
  function render(){{
    var q=(input.value||'').toLowerCase().trim();
    var shown=rows.filter(function(r){{return !q||(r.v+' '+r.d+' '+r.t+' '+r.p+' '+r.f+' '+r.doc).toLowerCase().indexOf(q)>=0}}).reverse();
    body.innerHTML=shown.map(function(r){{return '<tr><td>'+esc(r.v)+'</td><td>'+esc(r.d)+'</td><td><b>'+esc(r.t)+'</b></td><td>'+esc(r.p)+'</td><td>'+esc(r.f)+'</td><td><a href="'+encodeURI(r.doc)+'">'+esc(r.doc.replace(/\\.md$/,''))+'</a></td></tr>'}}).join('');
    count.textContent=shown.length+' of '+rows.length+' root causes';
  }}
  input.addEventListener('input',render);render();
}})();
</script>
{END}'''

def main():
    doc_dir, targets = sys.argv[1], sys.argv[2:]
    rows = entries(doc_dir)
    for path in targets:
        raw = open(path, encoding='utf8', newline='').read()
        nl = '\r\n' if '\r\n' in raw else '\n'
        new = block(rows).replace('\n', nl)
        if START in raw:
            a, b = raw.index(START), raw.index(END) + len(END)
            raw = raw[:a] + new + raw[b:]
        else:
            anchor = '<div class="todo-section glass" id="todo">'
            assert raw.count(anchor) == 1, (path, raw.count(anchor))
            raw = raw.replace(anchor, new + nl + nl + anchor)
        open(path, 'w', encoding='utf8', newline='').write(raw)
        print(f'{path}: {len(rows)} root causes')

if __name__ == '__main__':
    main()
