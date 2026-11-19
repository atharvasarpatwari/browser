/** Query parameters that exist only to track a click or campaign — never to select content. */
const TRACKING_PARAMS: ReadonlySet<string> = new Set([
  'gclid', 'gclsrc', 'gbraid', 'wbraid', 'dclid', '_ga', '_gl',
  'fbclid', 'fb_action_ids', 'fb_action_types', 'fb_source', 'fb_ref',
  'msclkid', 'ocid', 'yclid', 'twclid', 'ttclid', 'li_fat_id', 'igshid',
  'mc_eid', 'mc_cid', '_hsenc', '_hsmi', '__hssc', '__hstc', 'hsctatracking',
  'mkt_tok', 'vero_id', 'oly_anon_id', 'oly_enc_id', 'wickedid', 'irclickid', 'ref_src', 'ref_url',
]);

const TRACKING_PREFIXES: readonly string[] = ['utm_', 'pk_', 'mtm_', 'matomo_', 'piwik_', 'hsa_'];

/** Parameters that are tracking-only on specific sites but meaningful elsewhere. */
const HOST_SPECIFIC: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ['si', new Set(['youtube.com', 'youtu.be', 'open.spotify.com'])],
]);

function hostOf(base: string): string {
  const m = /^https?:\/\/(?:[^/@]*@)?([^/:?#]+)/i.exec(base);
  return m ? m[1]!.toLowerCase().replace(/^www\./, '') : '';
}

function decodeName(raw: string): string {
  try { return decodeURIComponent(raw.replace(/\+/g, ' ')); } catch { return raw; }
}

function isTrackingParam(name: string, host: string): boolean {
  const n = name.toLowerCase();
  if (TRACKING_PARAMS.has(n)) return true;
  if (TRACKING_PREFIXES.some((p) => n.startsWith(p))) return true;
  const hosts = HOST_SPECIFIC.get(n);
  return hosts !== undefined && [...hosts].some((h) => host === h || host.endsWith(`.${h}`));
}

/**
 * Removes tracking parameters from an http(s) URL. Everything else — parameter order, encoding,
 * the fragment, the path — is left byte-for-byte untouched, and the original string is returned
 * as-is when nothing was removed.
 */
function stripTrackingParams(url: string): string {
  if (!/^https?:\/\//i.test(url)) return url;
  const hash = url.indexOf('#');
  const fragment = hash >= 0 ? url.slice(hash) : '';
  const beforeHash = hash >= 0 ? url.slice(0, hash) : url;
  const q = beforeHash.indexOf('?');
  if (q < 0) return url;

  const base = beforeHash.slice(0, q);
  const host = hostOf(base);
  const kept: string[] = [];
  let removed = false;
  for (const pair of beforeHash.slice(q + 1).split('&')) {
    if (pair === '') continue;
    if (isTrackingParam(decodeName(pair.split('=')[0]!), host)) removed = true;
    else kept.push(pair);
  }
  if (!removed) return url;
  return base + (kept.length > 0 ? `?${kept.join('&')}` : '') + fragment;
}

export { stripTrackingParams, isTrackingParam };
