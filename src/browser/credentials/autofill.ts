import type { IDisposable } from '../../app/dependency-container';
import type { ICredentialStore, CredentialEntry } from './credential-store';

interface FormField {
  readonly name: string;
  readonly type: string;
  readonly value: string;
  readonly id: string;
  readonly className: string;
  readonly placeholder: string;
  readonly autocomplete: string;
  readonly disabled: boolean;
  readonly readOnly: boolean;
}

interface AutofillSuggestion {
  readonly credential: CredentialEntry;
  readonly confidence: number;
  readonly matchedField: string;
}

type AutofillEventKind = 'suggested' | 'filled' | 'saved' | 'cleared';
interface AutofillEvent {
  readonly kind: AutofillEventKind;
  readonly url: string;
  readonly credential?: CredentialEntry;
  readonly fieldCount?: number;
}

type AutofillEventHandler = (event: AutofillEvent) => void;

interface IAutofillService extends IDisposable {
  getCredentialsForUrl(url: string): CredentialEntry[];
  getSuggestions(url: string, fields: FormField[]): AutofillSuggestion[];
  fillFields(fields: FormField[], credential: CredentialEntry): FormField[];
  autoFill(url: string, fields: FormField[]): { filled: FormField[]; credential: CredentialEntry } | null;
  saveFromForm(url: string, fields: FormField[]): CredentialEntry | null;
  clear(url: string): void;
  onEvent(handler: AutofillEventHandler): () => void;
  get enabled(): boolean;
  set enabled(val: boolean);
}

function inferUsernameField(fields: FormField[]): FormField | undefined {
  return fields.find(f =>
    f.type === 'email' ||
    f.type === 'text' &&
    (f.autocomplete === 'username' ||
     f.name.toLowerCase().includes('user') ||
     f.name.toLowerCase().includes('email') ||
     f.name.toLowerCase() === 'login' ||
     f.id.toLowerCase().includes('user') ||
     f.id.toLowerCase().includes('email')),
  ) ?? fields.find(f => f.type === 'text' && !f.name.toLowerCase().includes('search') && !f.name.toLowerCase().includes('captcha'));
}

function inferPasswordField(fields: FormField[]): FormField | undefined {
  return fields.find(f => f.type === 'password');
}

function matchConfidence(credential: CredentialEntry, url: string, fields: FormField[]): number {
  let score = 0;
  const urlNorm = url.toLowerCase();
  const credUrlNorm = credential.url.toLowerCase();

  if (urlNorm === credUrlNorm) score += 60;
  else {
    try {
      const r = new URL(urlNorm);
      const c = new URL(credUrlNorm);
      if (r.hostname === c.hostname) score += 40;
      else if (r.hostname.endsWith('.' + c.hostname) || c.hostname.endsWith('.' + r.hostname)) score += 20;
    } catch { /* ignore */ }
  }

  for (const field of fields) {
    const fname = field.name.toLowerCase();
    const fauto = field.autocomplete.toLowerCase();
    if (fauto === 'username' || fname.includes('user') || fname === 'login') {
      score += 20;
    }
    if (fauto === 'current-password' || fauto === 'new-password' || fname.includes('password') || fname.includes('pass')) {
      score += 20;
    }
  }

  return score;
}

class AutofillService implements IAutofillService {
  private readonly store: ICredentialStore;
  private readonly handlers = new Set<AutofillEventHandler>();
  private _enabled = true;

  constructor(store: ICredentialStore) {
    this.store = store;
  }

  get enabled(): boolean { return this._enabled; }
  set enabled(val: boolean) { this._enabled = val; }

  getCredentialsForUrl(url: string): CredentialEntry[] {
    return this.store.getByUrl(url);
  }

  getSuggestions(url: string, fields: FormField[]): AutofillSuggestion[] {
    if (!this._enabled || fields.length === 0) return [];
    const candidates = this.store.getByUrl(url);
    const suggestions: AutofillSuggestion[] = [];

    for (const cred of candidates) {
      const conf = matchConfidence(cred, url, fields);
      if (conf > 0) {
        const matchedField = cred.username;
        suggestions.push({ credential: cred, confidence: conf, matchedField });
      }
    }

    suggestions.sort((a, b) => b.confidence - a.confidence);
    if (suggestions.length > 0) {
      this.emit({ kind: 'suggested', url, credential: suggestions[0].credential });
    }
    return suggestions;
  }

  fillFields(fields: FormField[], credential: CredentialEntry): FormField[] {
    const result = fields.map(f => ({ ...f }));

    const usernameField = inferUsernameField(result);
    const passwordField = inferPasswordField(result);

    if (usernameField) {
      const idx = result.findIndex(f => f.name === usernameField.name && f.id === usernameField.id);
      if (idx >= 0) result[idx] = { ...result[idx], value: credential.username };
    }
    if (passwordField) {
      const idx = result.findIndex(f => f.name === passwordField.name && f.id === passwordField.id);
      if (idx >= 0) result[idx] = { ...result[idx], value: credential.password };
    }

    this.store.recordUse(credential.id);
    this.emit({ kind: 'filled', url: credential.url, credential, fieldCount: result.length });
    return result;
  }

  autoFill(url: string, fields: FormField[]): { filled: FormField[]; credential: CredentialEntry } | null {
    const suggestions = this.getSuggestions(url, fields);
    if (suggestions.length === 0) return null;
    const best = suggestions[0];
    const filled = this.fillFields(fields, best.credential);
    return { filled, credential: best.credential };
  }

  saveFromForm(url: string, fields: FormField[]): CredentialEntry | null {
    if (!this._enabled) return null;
    const usernameField = inferUsernameField(fields);
    const passwordField = inferPasswordField(fields);
    if (!usernameField || !passwordField) return null;

    const existing = this.store.getByUrl(url);
    for (const cred of existing) {
      if (cred.username === usernameField.value) {
        const updated = this.store.update(cred.id, { password: passwordField.value, url });
        if (updated) {
          this.emit({ kind: 'saved', url, credential: updated });
          return updated;
        }
        return null;
      }
    }

    const entry = this.store.save({
      url,
      username: usernameField.value,
      password: passwordField.value,
      name: url.replace(/^https?:\/\//, '').split('/')[0],
    });
    this.emit({ kind: 'saved', url, credential: entry });
    return entry;
  }

  clear(url: string): void {
    this.emit({ kind: 'cleared', url });
  }

  onEvent(handler: AutofillEventHandler): () => void {
    this.handlers.add(handler);
    return () => { this.handlers.delete(handler); };
  }

  private emit(event: AutofillEvent): void {
    for (const h of this.handlers) {
      try { h(event); } catch { /* swallow */ }
    }
  }

  dispose(): void {
    this.handlers.clear();
    this._enabled = false;
  }
}

export { AutofillService, inferUsernameField, inferPasswordField, matchConfidence };
export type { IAutofillService, FormField, AutofillSuggestion, AutofillEvent, AutofillEventKind, AutofillEventHandler };
