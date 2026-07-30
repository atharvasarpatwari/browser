import type { IDisposable } from '../../app/dependency-container';

interface PrintOptions {
  readonly copies?: number;
  readonly pageRanges?: string;
  readonly duplex?: boolean;
  readonly color?: boolean;
  readonly landscape?: boolean;
  readonly paperSize?: 'A4' | 'Letter' | 'Legal';
  readonly margins?: 'default' | 'minimal' | 'none';
  readonly scale?: number;
  readonly background?: boolean;
}

interface PrintJob {
  readonly id: string;
  readonly url: string;
  readonly title: string;
  readonly options: PrintOptions;
  readonly status: PrintJobStatus;
  readonly createdAt: number;
  readonly completedAt?: number;
}

type PrintJobStatus = 'pending' | 'printing' | 'completed' | 'cancelled' | 'failed';

interface IPrintManager extends IDisposable {
  print(url: string, title?: string, options?: PrintOptions): PrintJob;
  cancel(jobId: string): boolean;
  getJob(jobId: string): PrintJob | null;
  getAllJobs(): PrintJob[];
  getActiveJobs(): PrintJob[];
  get defaultOptions(): PrintOptions;
  setDefaultOptions(options: PrintOptions): void;
  onEvent(handler: PrintEventHandler): () => void;
}

type PrintEventKind = 'jobCreated' | 'jobCompleted' | 'jobCancelled' | 'jobFailed';
interface PrintEvent {
  readonly kind: PrintEventKind;
  readonly job: PrintJob;
}

type PrintEventHandler = (event: PrintEvent) => void;

const DEFAULT_PRINT_OPTIONS: PrintOptions = {
  copies: 1,
  duplex: true,
  color: true,
  landscape: false,
  paperSize: 'A4',
  margins: 'default',
  scale: 100,
  background: false,
};

let jobCounter = 0;

class PrintManager implements IPrintManager {
  private jobs = new Map<string, PrintJob>();
  private _defaultOptions: PrintOptions = { ...DEFAULT_PRINT_OPTIONS };
  private handlers = new Set<PrintEventHandler>();

  get defaultOptions(): PrintOptions { return { ...this._defaultOptions }; }
  setDefaultOptions(options: PrintOptions): void { this._defaultOptions = { ...this._defaultOptions, ...options }; }

  print(url: string, title?: string, options?: PrintOptions): PrintJob {
    const id = `print-${++jobCounter}`;
    const opts = { ...this._defaultOptions, ...options };
    const job: PrintJob = {
      id, url, title: title ?? url, options: opts,
      status: 'pending', createdAt: Date.now(),
    };
    this.jobs.set(id, job);
    this.emit({ kind: 'jobCreated', job: { ...job } });

    setTimeout(() => {
      const j = this.jobs.get(id);
      if (!j || j.status === 'cancelled') return;
      j.status = 'printing';
      setTimeout(() => {
        const j2 = this.jobs.get(id);
        if (!j2 || j2.status === 'cancelled') return;
        j2.status = 'completed';
        (j2 as { completedAt?: number }).completedAt = Date.now();
        this.emit({ kind: 'jobCompleted', job: { ...j2 } });
      }, 100);
    }, 50);

    return { ...job };
  }

  cancel(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job || job.status === 'completed') return false;
    job.status = 'cancelled';
    this.emit({ kind: 'jobCancelled', job: { ...job } });
    return true;
  }

  getJob(jobId: string): PrintJob | null {
    const j = this.jobs.get(jobId);
    return j ? { ...j } : null;
  }

  getAllJobs(): PrintJob[] {
    return [...this.jobs.values()].map(j => ({ ...j }));
  }

  getActiveJobs(): PrintJob[] {
    return [...this.jobs.values()].filter(j => j.status === 'pending' || j.status === 'printing').map(j => ({ ...j }));
  }

  onEvent(handler: PrintEventHandler): () => void {
    this.handlers.add(handler);
    return () => { this.handlers.delete(handler); };
  }

  private emit(event: PrintEvent): void {
    for (const h of this.handlers) {
      try { h(event); } catch { /* swallow */ }
    }
  }

  dispose(): void {
    for (const job of this.jobs.values()) {
      if (job.status === 'pending' || job.status === 'printing') {
        job.status = 'cancelled';
      }
    }
    this.jobs.clear();
    this.handlers.clear();
  }
}

export { PrintManager, DEFAULT_PRINT_OPTIONS };
export type { IPrintManager, PrintJob, PrintOptions, PrintJobStatus, PrintEvent, PrintEventKind, PrintEventHandler };
