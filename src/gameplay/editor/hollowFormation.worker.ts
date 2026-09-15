import { generateHollowFormation, type HollowFormationRequest } from './generateHollowFormation';

self.onmessage = (event: MessageEvent<HollowFormationRequest>) => {
  try {
    const path = generateHollowFormation(event.data, (progress) => self.postMessage({ progress }));
    self.postMessage({ path });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : '镂空造型生成失败。' });
  }
};
