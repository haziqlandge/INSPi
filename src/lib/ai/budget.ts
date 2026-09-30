/** Providers count input + requested output against a per-minute allowance; keep 5% spare for estimate error. */
const SAFETY = 0.95;
const CHARS_PER_TOKEN = 3.6;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export interface CallPlan {
  inputTokens: number;
  maxOutput: number;
}

export interface PlanOptions {
  tpm: number;
  modelMaxOutput: number;
  tokensPerImage: number;
  promptTokens: number;
  images: number;
  wantOutput: number;
  minOutput: number;
}

/** Null means the call cannot produce a useful answer inside one minute's allowance. */
export function planCall(o: PlanOptions): CallPlan | null {
  const inputTokens = o.promptTokens + o.images * o.tokensPerImage;
  const available = Math.floor(o.tpm * SAFETY) - inputTokens;
  if (available < o.minOutput) return null;
  return { inputTokens, maxOutput: Math.min(o.wantOutput, available, o.modelMaxOutput) };
}

export interface FrameOptions {
  tpm: number;
  tokensPerImage: number;
  maxImages: number;
  promptTokens: number;
  minOutput: number;
}

/** How many frames fit in one observe call while leaving room for the answer. */
export function framesPerCall(o: FrameOptions): number {
  const room = Math.floor(o.tpm * SAFETY) - o.promptTokens - o.minOutput;
  if (room < o.tokensPerImage) return 0;
  return Math.min(o.maxImages, Math.floor(room / o.tokensPerImage));
}
