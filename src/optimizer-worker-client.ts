import type { Container, LibraryItem, PackingPlan, Trip } from './types';

export interface PlannerWorkerRequest {
  requestId: number;
  trip: Trip;
  items: LibraryItem[];
  containers: Container[];
}

export interface PlannerWorkerResponse {
  requestId: number;
  plan?: PackingPlan;
  error?: string;
}

interface PendingRequest {
  requestId: number;
  worker: Worker;
  resolve: (response: PlannerWorkerResponse) => void;
  reject: (error: Error) => void;
}

export class PlannerWorkerClient {
  private worker?: Worker;
  private pending?: PendingRequest;
  private idleTimer?: ReturnType<typeof setTimeout>;

  constructor(private readonly createWorker: () => Worker, private readonly idleTimeoutMs = 10_000) {}

  calculate(request: PlannerWorkerRequest): Promise<PlannerWorkerResponse> {
    if (this.pending) this.cancel(this.pending.requestId);
    this.clearIdleTimer();

    let worker = this.worker;
    try {
      if (!worker) this.worker = worker = this.createWorker();
    } catch (error) {
      return Promise.reject(error);
    }

    return new Promise((resolve, reject) => {
      const pending: PendingRequest = { requestId: request.requestId, worker, resolve, reject };
      this.pending = pending;
      worker.onmessage = (event: MessageEvent<PlannerWorkerResponse>) => {
        if (this.pending !== pending || event.data.requestId !== pending.requestId) return;
        this.pending = undefined;
        resolve(event.data);
        this.scheduleIdleTermination(worker);
      };
      worker.onerror = (event: ErrorEvent) => {
        if (this.pending !== pending) return;
        this.pending = undefined;
        this.releaseWorker(worker);
        reject(new Error(event.message || 'The packing planner worker failed.'));
      };
      try {
        worker.postMessage(request);
      } catch (error) {
        if (this.pending === pending) this.pending = undefined;
        this.releaseWorker(worker);
        reject(error instanceof Error ? error : new Error('The packing planner worker could not be started.'));
      }
    });
  }

  cancel(requestId: number) {
    const pending = this.pending;
    if (!pending || pending.requestId !== requestId) return;
    this.pending = undefined;
    this.releaseWorker(pending.worker);
    pending.reject(new Error('The packing plan request was cancelled.'));
  }

  dispose() {
    const pending = this.pending;
    this.pending = undefined;
    if (this.worker) this.releaseWorker(this.worker);
    if (pending) pending.reject(new Error('The planner worker client was disposed.'));
  }

  private scheduleIdleTermination(worker: Worker) {
    this.clearIdleTimer();
    this.idleTimer = setTimeout(() => {
      this.idleTimer = undefined;
      if (this.worker === worker && !this.pending) this.releaseWorker(worker);
    }, this.idleTimeoutMs);
  }

  private clearIdleTimer() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = undefined;
  }

  private releaseWorker(worker: Worker) {
    this.clearIdleTimer();
    worker.onmessage = null;
    worker.onerror = null;
    worker.terminate();
    if (this.worker === worker) this.worker = undefined;
  }
}
