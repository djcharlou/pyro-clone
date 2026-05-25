/// <reference lib="webworker" />
import { analyzeTrack, type AnalyzeInput } from './pipeline';
import type { TrackAnalysis } from '@shared/types';

export interface AnalyzeRequest {
  id: string;
  input: AnalyzeInput;
}

export type AnalyzeResponse =
  | { id: string; ok: true; result: TrackAnalysis }
  | { id: string; ok: false; error: string };

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (e: MessageEvent<AnalyzeRequest>): void => {
  const { id, input } = e.data;
  try {
    const result = analyzeTrack(input);
    const msg: AnalyzeResponse = { id, ok: true, result };
    ctx.postMessage(msg);
  } catch (err) {
    const msg: AnalyzeResponse = {
      id,
      ok: false,
      error: (err as Error).message,
    };
    ctx.postMessage(msg);
  }
};
