import { batchPlaytestConcurrency } from '../editor/batchWorkerConcurrency';
import type { ConfigurationSimulationInput, ConfigurationSimulationOutput, ConfigurationSimulationResponse } from './configurationSimulationProtocol';

interface Job { id: number; input: ConfigurationSimulationInput; resolve: (result: ConfigurationSimulationOutput) => void; reject: (error: Error) => void; onProgress?: (completed: number) => void }
interface Slot { worker: Worker; job?: Job }
export const configurationSimulationConcurrency = () => Math.min(8, batchPlaytestConcurrency());

export class ConfigurationSimulationPool {
  private slots: Slot[] = [];
  private queue: Job[] = [];
  private nextId = 1;
  private closed = false;
  constructor(private readonly limit = configurationSimulationConcurrency()) {}
  get stopped(): boolean { return this.closed; }

  run(input: ConfigurationSimulationInput, onProgress?: (completed: number) => void): Promise<ConfigurationSimulationOutput> {
    if (this.closed) return Promise.reject(new DOMException('批量计算已取消', 'AbortError'));
    return new Promise((resolve, reject) => {
      this.queue.push({ id: this.nextId++, input, resolve, reject, onProgress }); this.dispatch();
    });
  }
  dispose(error: Error = new DOMException('批量计算已取消', 'AbortError')): void {
    this.closed = true;
    this.queue.splice(0).forEach((job) => job.reject(error));
    this.slots.splice(0).forEach((slot) => { slot.worker.terminate(); slot.job?.reject(error); slot.job = undefined; });
  }
  private dispatch(): void {
    while (!this.closed && this.queue.length) {
      let slot = this.slots.find((candidate) => !candidate.job);
      if (!slot) {
        if (this.slots.length >= this.limit) return;
        try { slot = this.createSlot(); this.slots.push(slot); }
        catch (error) { this.dispose(error instanceof Error ? error : new Error(String(error))); return; }
      }
      slot.job = this.queue.shift()!;
      try { slot.worker.postMessage({ assetBaseUrl: typeof document === 'undefined' ? undefined : new URL(import.meta.env.BASE_URL, document.baseURI).href,
        ...slot.job.input, jobId: slot.job.id }); }
      catch (error) { this.dispose(error instanceof Error ? error : new Error(String(error))); }
    }
  }
  private createSlot(): Slot {
    const slot: Slot = { worker: new Worker(new URL('./configurationSimulation.worker.ts', import.meta.url), { type: 'module', name: 'arranger-batch-simulation' }) };
    slot.worker.addEventListener('message', (event: MessageEvent<ConfigurationSimulationResponse>) => {
      const response = event.data, job = slot.job;
      if (!job || job.id !== response.jobId || this.closed) return;
      if ('progress' in response) { job.onProgress?.(response.progress); return; }
      slot.job = undefined;
      if ('error' in response) job.reject(new Error(response.error)); else job.resolve(response.result);
      this.dispatch();
    });
    slot.worker.addEventListener('error', (event) => {
      event.preventDefault(); this.dispose(new Error(event.message || '批量计算线程加载失败'));
    });
    slot.worker.addEventListener('messageerror', () => this.dispose(new Error('批量计算线程数据读取失败')));
    return slot;
  }
}
