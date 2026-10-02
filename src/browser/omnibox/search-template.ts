interface SearchTemplateValues {
  readonly searchTerms: string;
  readonly count?: number;
  readonly startIndex?: number;
  readonly startPage?: number;
  readonly language?: string;
  readonly inputEncoding?: string;
  readonly outputEncoding?: string;
}

// OpenSearch 1.1 §4.3 defaults for parameters the caller does not supply.
const DEFAULTS: Required<Omit<SearchTemplateValues, 'searchTerms'>> = {
  count: 10,
  startIndex: 1,
  startPage: 1,
  language: '*',
  inputEncoding: 'UTF-8',
  outputEncoding: 'UTF-8',
};

/**
 * Expands both OpenSearch placeholders (`{searchTerms}`, `{count?}`, …) and the Chrome-style `%s`.
 * A supplied value always wins; otherwise a required placeholder takes the spec default and an
 * optional one (`{x?}`) becomes empty. Unknown/extension placeholders (`{moz:locale}`) become empty.
 */
function expandSearchTemplate(template: string, values: SearchTemplateValues): string {
  const terms = encodeURIComponent(values.searchTerms);
  return template.replace(/\{([\w:.-]+)(\??)\}|%s/g, (_match, name: string | undefined, optional: string | undefined) => {
    if (name === undefined || name === 'searchTerms') return terms; // %s or {searchTerms}
    if (!(name in DEFAULTS)) return '';
    const key = name as keyof typeof DEFAULTS;
    const supplied = values[key];
    if (supplied !== undefined) return encodeURIComponent(String(supplied));
    return optional ? '' : encodeURIComponent(String(DEFAULTS[key]));
  });
}

/** True when the template can carry a query (OpenSearch `{searchTerms}` or `%s`). */
function hasSearchPlaceholder(template: string): boolean {
  return /\{searchTerms\??\}|%s/.test(template);
}

export { expandSearchTemplate, hasSearchPlaceholder };
export type { SearchTemplateValues };
