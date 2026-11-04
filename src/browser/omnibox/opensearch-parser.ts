export function parseOpenSearchXml(xml: string): OpenSearchDescription | null {
  try {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    if (!doc || doc.getElementsByTagName('parsererror').length > 0) return null;

    const root = doc.documentElement;

    function getElementText(name: string): string {
      const el = root.getElementsByTagName(name)[0];
      return el ? el.textContent || '' : '';
    }

    function getElementAttribute(name: string, attr: string): string {
      const el = root.getElementsByTagName(name)[0];
      return el ? (el.getAttribute(attr) || '') : '';
    }

    const title = getElementText('ShortName') || getElementText('Title') || '';
    const description = getElementText('Description') || '';
    const url = getElementText('Input') || getElementText('Url');
    const language = getElementText('Language');
    const inputEncoding = getElementText('InputEncoding');
    const outputEncoding = getElementText('OutputEncoding');
    const authorName = getElementText('Author');
    const authorUri = getElementAttribute('Author', 'URI');
    const keywords = getElementText('Keywords').split(',').map((k: string) => k.trim()).filter((k: string) => k.length > 0);
    const longName = getElementText('LongName');
    const shortName = getElementText('ShortName');
    const favicon = getElementText('Icon');

    let urlTemplate = url;
    if (!urlTemplate && root.getElementsByTagName('Url').length > 0) {
      const urlEl = root.getElementsByTagName('Url')[0];
      urlTemplate = urlEl.getAttribute('template') || urlEl.textContent || '';
    }

    return {
      title,
      description,
      url: urlTemplate,
      language,
      inputEncoding,
      outputEncoding,
      author: authorName ? { name: authorName, uri: authorUri } : undefined,
      keywords: keywords.length > 0 ? keywords : undefined,
      longName,
      shortName,
      favicon,
    };
  } catch {
    return null;
  }
}

export type { OpenSearchDescription };

export function extractSearchEngineFromOpenSearch(desc: OpenSearchDescription): SearchEngine | null {
  if (!desc.title || !desc.url) return null;

  const keyword = desc.shortName ? desc.shortName.toLowerCase().replace(/\s+/g, '') : '';
  const name = desc.title || 'Unknown Search Engine';
  const url = desc.url;
  const icon = desc.favicon ? `data:image/x-icon;base64,${desc.favicon}` : '🔍';

  return {
    id: `opensearch-${keyword || Date.now()}`,
    name,
    url,
    keyword: keyword || `opensearch-${Date.now()}`,
    icon,
    isDefault: false,
  };
}

interface SearchEngine {
  readonly id: string;
  readonly name: string;
  readonly url: string;
  readonly keyword: string;
  readonly icon?: string;
  isDefault: boolean;
}

interface OpenSearchDescription {
  readonly title: string;
  readonly description: string;
  readonly url: string; // Template URL with {searchTerms}
  readonly language?: string;
  readonly inputEncoding?: string;
  readonly outputEncoding?: string;
  readonly author?: { readonly name: string; readonly uri: string };
  readonly keywords?: string[];
  readonly longName?: string;
  readonly shortName?: string;
  readonly favicon?: string;
  readonly encoder?: string;
}