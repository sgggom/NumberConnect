import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfigurationSimulationPool, configurationSimulationConcurrency } from './configurationSimulationPool';
import type { ConfigurationSimulationInput, ConfigurationSimulationRequest, ConfigurationSimulationResponse } from './configurationSimulationProtocol';

class FakeWorker {
  static instances: FakeWorker[] = [];
  requests: ConfigurationSimulationRequest[] = [];
  terminated = false;
  listeners = new Map<string, (event: unknown) => void>();
  constructor() { FakeWorker.instances.push(this); }
  addEventListener(type: string, listener: (event: unknown) => void) { this.listeners.set(type, listener); }
  postMessage(request: ConfigurationSimulationRequest) { this.requests.push(request); }
  terminate() { this.terminated = true; }
  respond(response: ConfigurationSimulationResponse) { this.listeners.get('message')?.({ data: response }); }
}
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); FakeWorker.instances = []; });
const input = {} as ConfigurationSimulationInput;
const result = { metrics: { total: 2, hidden: 0, longConnections: 0, mediumConnections: 0, singleCertain: 0, singleMisleading: 0, twoGapOne: 0, twoGapTwo: 0, multiple: 0, bottlenecks: 0, errors: 0 }, status: '已通关' };
describe('arranger simulation workers', () => {
  it('runs bounded concurrent jobs, reuses idle workers and ignores stale responses', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const pool = new ConfigurationSimulationPool(2);
    const first = pool.run(input), second = pool.run(input), third = pool.run(input);
    expect(FakeWorker.instances).toHaveLength(2);
    const [a, b] = FakeWorker.instances;
    b.respond({ jobId: b.requests[0].jobId, result });
    await expect(second).resolves.toEqual(result);
    expect(b.requests).toHaveLength(2);
    b.respond({ jobId: b.requests[0].jobId, error: 'stale' });
    b.respond({ jobId: b.requests[1].jobId, result });
    a.respond({ jobId: a.requests[0].jobId, result });
    await expect(Promise.all([first, third])).resolves.toEqual([result, result]);
    pool.dispose(); expect(a.terminated && b.terminated).toBe(true);
  });
  it('cancels running and queued jobs immediately and releases workers', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const pool = new ConfigurationSimulationPool(1);
    const settled = Promise.allSettled([pool.run(input), pool.run(input)]);
    pool.dispose();
    expect((await settled).every((entry) => entry.status === 'rejected' && entry.reason.name === 'AbortError')).toBe(true);
    expect(FakeWorker.instances[0].terminated).toBe(true);
    await expect(pool.run(input)).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('rejects pending work on startup failure rather than hanging the queue', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const pool = new ConfigurationSimulationPool(1);
    const settled = Promise.allSettled([pool.run(input), pool.run(input)]);
    FakeWorker.instances[0].listeners.get('error')?.({ message: 'load failed', preventDefault() {} });
    expect((await settled).every((entry) => entry.status === 'rejected' && entry.reason.message === 'load failed')).toBe(true);
    expect(pool.stopped).toBe(true);
  });
  it('uses high-core-count devices without an eight-thread cap and accepts explicit concurrency', () => {
    vi.stubGlobal('navigator', { hardwareConcurrency: 32 }); expect(configurationSimulationConcurrency()).toBe(31);
    vi.stubGlobal('navigator', { hardwareConcurrency: 64 }); expect(configurationSimulationConcurrency()).toBe(63);
    expect(configurationSimulationConcurrency(64)).toBe(64);
    expect(configurationSimulationConcurrency(1)).toBe(1);
    expect(configurationSimulationConcurrency(-1)).toBe(63);
    vi.stubGlobal('navigator', { hardwareConcurrency: 4 }); expect(configurationSimulationConcurrency()).toBe(3);
    vi.stubGlobal('navigator', { hardwareConcurrency: 1 }); expect(configurationSimulationConcurrency()).toBe(1);
  });
  it('passes the document base to workers for GitHub Pages subdirectory assets', async () => {
    vi.stubEnv('BASE_URL', './');
    vi.stubGlobal('Worker', FakeWorker);
    vi.stubGlobal('document', { baseURI: 'https://sgggom.github.io/NumberConnect/' });
    const pool = new ConfigurationSimulationPool(1);
    const pending = pool.run(input);
    const worker = FakeWorker.instances[0], request = worker.requests[0];
    expect(request.assetBaseUrl).toBe('https://sgggom.github.io/NumberConnect/');
    worker.respond({ jobId: request.jobId, result }); await pending; pool.dispose();
  });
});
