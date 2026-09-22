import { PathCompletionSolver } from '../../game/pathCompletionSolver';
import { simulateRepeatedConfiguration } from './repeatedConfigurationSimulation';
import { WorkerHandOcclusion } from './workerHandOcclusion';
import type { ConfigurationSimulationRequest, ConfigurationSimulationResponse } from './configurationSimulationProtocol';

const sampler = new WorkerHandOcclusion();
const scope = self as unknown as {
  addEventListener(type: 'message', listener: (event: MessageEvent<ConfigurationSimulationRequest>) => void): void;
  postMessage(message: ConfigurationSimulationResponse): void;
};
scope.addEventListener('message', (event) => {
  void (async () => {
    const { jobId, level, geometry, mode, player, weights, seed, repetitions, assetBaseUrl } = event.data;
    try {
      const solver = new PathCompletionSolver(level.solutionPath, level.boardShape);
      let lastProgressAt = 0;
      const result = await simulateRepeatedConfiguration({ level, memorySteps: 0, player, weights, seed, yieldToUI: false,
        observe: sampler.forGeometry(mode, geometry, assetBaseUrl), findCompletion: async (request) => solver.findCompletion(request) }, repetitions,
        (progress) => {
          const now = performance.now();
          if (progress === (repetitions ?? 1) || now - lastProgressAt >= 100) {
            lastProgressAt = now; scope.postMessage({ jobId, progress });
          }
        });
      scope.postMessage({ jobId, result });
    } catch (error) { scope.postMessage({ jobId, error: error instanceof Error ? error.message : String(error) }); }
  })();
});
