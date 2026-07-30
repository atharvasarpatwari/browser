export interface CertificateInfo {
  issuer: string;
  subject: string;
  validFrom: string;
  validTo: string;
  fingerprint: string;
  serialNumber: string;
  isSelfSigned: boolean;
}

export interface CSPViolation {
  id: string;
  timestamp: number;
  blockedUri: string;
  violatedDirective: string;
  sourceFile: string;
  lineNumber: number;
  disposition: 'enforce' | 'report';
}

export interface CORSIssue {
  id: string;
  timestamp: number;
  url: string;
  reason: string;
  method: string;
  blocked: boolean;
}

export interface MixedContentWarning {
  id: string;
  timestamp: number;
  initiatorUrl: string;
  targetUrl: string;
  type: 'active' | 'passive';
}

export type SecuritySummary = 'secure' | 'insecure' | 'mixed' | 'unknown';

export type SecurityEventType =
  | 'certificateUpdated' | 'cspViolation' | 'corsIssue'
  | 'mixedContent' | 'summaryChanged' | 'cleared';

export interface SecurityEvent {
  kind: SecurityEventType;
  certificate?: CertificateInfo;
  csp?: CSPViolation;
  cors?: CORSIssue;
  mixed?: MixedContentWarning;
  summary?: SecuritySummary;
}

export type SecurityEventHandler = (event: SecurityEvent) => void;

export class SecurityPanel {
  private certificate: CertificateInfo | null = null;
  private cspViolations: CSPViolation[] = [];
  private corsIssues: CORSIssue[] = [];
  private mixedWarnings: MixedContentWarning[] = [];
  private summary: SecuritySummary = 'unknown';
  private handlers = new Set<SecurityEventHandler>();
  private counter = 0;

  setCertificate(info: CertificateInfo): void {
    this.certificate = info;
    this.emit({ kind: 'certificateUpdated', certificate: info });
  }

  getCertificate(): CertificateInfo | null { return this.certificate; }

  addCSPViolation(violation: Omit<CSPViolation, 'id' | 'timestamp'>): CSPViolation {
    this.counter++;
    const v: CSPViolation = { id: `csp-${this.counter}`, timestamp: Date.now(), ...violation };
    this.cspViolations.push(v);
    this.emit({ kind: 'cspViolation', csp: v });
    return v;
  }

  getCSPViolations(): CSPViolation[] { return [...this.cspViolations]; }

  addCORSIssue(issue: Omit<CORSIssue, 'id' | 'timestamp'>): CORSIssue {
    this.counter++;
    const i: CORSIssue = { id: `cors-${this.counter}`, timestamp: Date.now(), ...issue };
    this.corsIssues.push(i);
    this.emit({ kind: 'corsIssue', cors: i });
    return i;
  }

  getCORSIssues(): CORSIssue[] { return [...this.corsIssues]; }

  addMixedContent(warning: Omit<MixedContentWarning, 'id' | 'timestamp'>): MixedContentWarning {
    this.counter++;
    const w: MixedContentWarning = { id: `mix-${this.counter}`, timestamp: Date.now(), ...warning };
    this.mixedWarnings.push(w);
    this.setSummary(this.mixedWarnings.length > 0 ? 'mixed' : this.summary);
    this.emit({ kind: 'mixedContent', mixed: w });
    return w;
  }

  getMixedContentWarnings(): MixedContentWarning[] { return [...this.mixedWarnings]; }

  setSummary(summary: SecuritySummary): void {
    this.summary = summary;
    this.emit({ kind: 'summaryChanged', summary });
  }

  getSummary(): SecuritySummary { return this.summary; }

  getSecurityReport(): { summary: SecuritySummary; certificate: CertificateInfo | null; cspCount: number; corsCount: number; mixedCount: number } {
    return {
      summary: this.summary,
      certificate: this.certificate,
      cspCount: this.cspViolations.length,
      corsCount: this.corsIssues.length,
      mixedCount: this.mixedWarnings.length,
    };
  }

  clear(): void {
    this.certificate = null;
    this.cspViolations = [];
    this.corsIssues = [];
    this.mixedWarnings = [];
    this.counter = 0;
    this.emit({ kind: 'cleared' });
  }

  onEvent(handler: SecurityEventHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  dispose(): void {
    this.clear();
    this.handlers.clear();
  }

  private emit(event: SecurityEvent): void {
    for (const h of this.handlers) {
      try { h(event); } catch { }
    }
  }
}
