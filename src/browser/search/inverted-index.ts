import { IIndexedDBBackend } from '../storage/indexed-db';

interface InvertedIndexEntry {
  readonly docId: string;
  readonly title: string;
  readonly url: string;
  readonly snippet: string;
  readonly score?: number;
}

type IndexedSearchDB = {
  readonly version: number;
  objectStores: {
    documents: IDBObjectStore;
    invertedIndex: IDBObjectStore;
    docStats: IDBObjectStore;
  };
};

const INDEX_STORE = 'invertedIndex';
const DOC_STORE = 'documents';
const STATS_STORE = 'docStats';
const TOKEN_FIELD = 'tokens';
const URL_FIELD = 'url';
const TITLE_FIELD = 'title';
const SNIPPET_FIELD = 'snippet';

function tokenize(text: string): string[] {
  if (!text) return [];
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((token: string) => token.length >= 2);
}

function computeIdf(docCount: number, termDocFreq: number): number {
  if (termDocFreq === 0) return 0;
  return Math.log(docCount / termDocFreq) + 1;
}

function computeBm25(
  docFreq: number,
  docCount: number,
  avgDocLen: number,
  docLen: number,
  termFreq: number,
  k1: number = 1.5,
  b: number = 0.75
): number {
  const idf = computeIdf(docCount, docFreq);
  const tf = termFreq;
  const k1b = k1 * (1 - b + b * docLen / avgDocLen);
  return idf * (tf * (k1 + 1) / (tf + k1b));
}

class InvertedIndexSearch {
  private readonly backend: IIndexedDBBackend;
  private origin: string;
  private dbName = 'nova-search';
  private docCount = 0;
  private avgDocLen = 0;

  constructor(backend: IIndexedDBBackend, origin: string) {
    this.backend = backend;
    this.origin = origin;
  }

  async init(): Promise<void> {
    const db = await this.backend.loadDatabase(this.origin, this.dbName);
    if (db) {
      this.docCount = db.objectStores.documents?.data?.length || 0;
      this.avgDocLen = this.computeAvgDocLenFromData(db.objectStores.documents?.data || []);
    }
  }

  private computeAvgDocLenFromData(entries: Array<[unknown, Record<string, unknown>]>): number {
    if (entries.length === 0) return 0;
    const totalLength = entries.reduce((sum, [, val]) => {
      const tokens = val[TOKEN_FIELD] as string[] || [];
      return sum + tokens.length;
    }, 0);
    return totalLength / entries.length;
  }

  async addDocument(docId: string, url: string, title: string, content: string): Promise<void> {
    const tokens = tokenize(content + ' ' + title);
    const docLen = tokens.length;

    const db = await this.backend.loadDatabase(this.origin, this.dbName) || {
      version: 1,
      objectStores: {
        documents: { keyPath: null, autoIncrement: false, data: [], indexes: {} },
        invertedIndex: { keyPath: TOKEN_FIELD, autoIncrement: false, data: [], indexes: {} },
        docStats: { keyPath: null, autoIncrement: false, data: [], indexes: {} },
      },
    };

    // Store document
    const docStore = db.objectStores.documents;
    docStore.data.push([docId, { url, title, tokens, docLen }]);

    // Build/update inverted index
    const invStore = db.objectStores.invertedIndex;
    for (const token of tokens) {
      const existingEntry = invStore.data.find(([k]) => k === token);
      const existingDocIds = existingEntry ? existingEntry[1].docIds as string[] : [];
      const newDocIds = [...existingDocIds, docId];
      const idx = invStore.data.findIndex(([k]) => k === token);
      if (idx >= 0) {
        invStore.data[idx][1].docIds = newDocIds;
      } else {
        invStore.data.push([token, { docIds: newDocIds }]);
      }
    }

    // Update stats
    const statsStore = db.objectStores.docStats;
    const countEntry = statsStore.data.find(([k]) => k === 'count');
    const currentCount = countEntry ? (countEntry[1].count as number) : 0;
    statsStore.data = [
      ...statsStore.data.filter(([k]) => k !== 'count'),
      ['count', { count: currentCount + 1 }],
    ];

    const lenEntry = statsStore.data.find(([k]) => k === 'totalLen');
    const currentTotalLen = lenEntry ? (lenEntry[1].totalLen as number) : 0;
    statsStore.data = [
      ...statsStore.data.filter(([k]) => k !== 'totalLen'),
      ['totalLen', { totalLen: currentTotalLen + docLen }],
    ];

    await this.backend.saveDatabase(this.origin, this.dbName, {
      version: 1,
      objectStores: db.objectStores,
    });

    this.docCount = currentCount + 1;
    this.avgDocLen = (this.avgDocLen * (this.docCount - 1) + docLen) / this.docCount;
  }

  async search(query: string, maxResults = 10): Promise<InvertedIndexEntry[]> {
    if (this.docCount === 0) return [];

    const tokens = tokenize(query);
    if (tokens.length === 0) return [];

    // Load database once
    const loadedDb = this.backend.loadDatabase(this.origin, this.dbName);
    const docIndex = loadedDb?.objectStores.invertedIndex?.data || [];
    const docStore = loadedDb?.objectStores.documents;

    // Build scores: for each token, find matching docs and accumulate BM25 scores
    const scores = new Map<string, number>();

    for (const token of tokens) {
      // Find entries in inverted index that match this token
      const matchingIndexEntries = docIndex.filter((entry): entry is [string, any] => {
        const k = entry[0] as string;
        return tokens.some((t) => t === k.toLowerCase());
      });

      for (const [docIdKey, val] of matchingIndexEntries) {
        const docFreq = matchingIndexEntries.length;
        const idf = computeIdf(this.docCount, docFreq);

        // Get document data from docStore
        const docData = docStore?.data?.find(([k]) => k === docIdKey);
        if (!docData) continue;

        const [, valObj] = docData;
        const existingScore = scores.get(docIdKey) || 0;
        const tf = (valObj.docIds as string[]).filter((id: string) => id === docIdKey).length || 0;
        const docActualLen = valObj.docLen as number || 0;

        const bm25 = computeBm25(docFreq, this.docCount, this.avgDocLen, docActualLen, tf);
        scores.set(docIdKey, existingScore + bm25);
      }
    }

    // Get document details for top-scoring docs
    const results: InvertedIndexEntry[] = [];

    const sortedDocIds = [...scores.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, maxResults);

    for (const [docId, score] of sortedDocIds) {
      const entry = docStore?.data?.find(([k]) => k === docId);
      if (entry) {
        const [, val] = entry as [string, { title: string; url: string; docLen: number; docIds: string[] }];
        results.push({
          docId: docId as string,
          title: val.title,
          url: val.url,
          snippet: this.generateSnippet(tokens, val.title),
          score: score,
        });
      }
    }

    return results;
  }

  private generateSnippet(tokens: string[], text: string): string {
    const sentenceRegex = /[^.!?]*[.!?]/g;
    const sentences = text.match(sentenceRegex) || [text];

    for (const sentence of sentences) {
      const lowerSentence = sentence.toLowerCase();
      let matchScore = 0;

      for (const token of tokens) {
        if (lowerSentence.includes(token)) {
          matchScore++;
        }
      }

      if (matchScore > 0) {
        let highlighted = sentence;
        for (const token of tokens) {
          const regex = new RegExp(`(${token})`, 'gi');
          highlighted = highlighted.replace(regex, '<mark>$1</mark>');
        }
        return highlighted;
      }
    }

    if (tokens.length > 0) {
      const first = tokens[0];
      const regex = new RegExp(`(${first})`, 'gi');
      return text.replace(regex, '<mark>$1</mark>');
    }

    return text.substring(0, 200) + '...';
  }

  async removeDocument(docId: string): Promise<void> {
    const db = this.backend.loadDatabase(this.origin, this.dbName);
    if (!db) return;

    const docStore = db.objectStores.documents;
    const docIndex = docStore.data.findIndex(([k]) => k === docId);
    if (docIndex >= 0) {
      docStore.data.splice(docIndex, 1);
    }

    const invStore = db.objectStores.invertedIndex;
    for (const [key, val] of invStore.data) {
      const docIds = val.docIds as string[];
      const filtered = docIds.filter((id: string) => id !== docId);
      val.docIds = filtered;
    }

    const statsStore = db.objectStores.docStats;
    const countEntry = statsStore.data.find(([k]) => k === 'count');
    if (countEntry) {
      countEntry[1].count = Math.max(0, (countEntry[1].count as number) - 1);
    }

    await this.backend.saveDatabase(this.origin, this.dbName, {
      version: 1,
      objectStores: db.objectStores,
    });

    this.docCount = Math.max(0, this.docCount - 1);
  }

  async clear(): Promise<void> {
    await this.backend.saveDatabase(this.origin, this.dbName, {
      version: 1,
      objectStores: {
        documents: { keyPath: null, autoIncrement: false, data: [], indexes: {} },
        invertedIndex: { keyPath: TOKEN_FIELD, autoIncrement: false, data: [], indexes: {} },
        docStats: { keyPath: null, autoIncrement: false, data: [], indexes: {} },
      },
    });

    this.docCount = 0;
    this.avgDocLen = 0;
  }
}

export { InvertedIndexSearch };
export type { InvertedIndexEntry, IndexedSearchDB };