import { describe, expect, it } from 'vitest';
import { estimateTokens, framesPerCall, planCall } from '@/lib/ai/budget';
import { parseDuration, readRateInfo, waitBeforeCall } from '@/lib/ai/ratelimit';

describe('estimateTokens', () => {
  it('rounds up at roughly 3.6 characters per token', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('a'.repeat(36))).toBe(10);
    expect(estimateTokens('a'.repeat(37))).toBe(11);
  });
});

describe('planCall', () => {
  const groqFree = { tpm: 8000, modelMaxOutput: 16384, tokensPerImage: 2048 };

  it('fits one image and caps output to what the minute allows', () => {
    const plan = planCall({ ...groqFree, promptTokens: 1600, images: 1, wantOutput: 6000, minOutput: 2500 });
    expect(plan).not.toBeNull();
    expect(plan!.inputTokens).toBe(3648);
    // 95% of 8000 = 7600, minus 3648 input
    expect(plan!.maxOutput).toBe(3952);
  });

  it('returns null when the answer would not fit', () => {
    expect(planCall({ ...groqFree, promptTokens: 1600, images: 3, wantOutput: 4000, minOutput: 2500 })).toBeNull();
  });

  it('never exceeds the wanted output or the model maximum', () => {
    const big = { tpm: 250000, modelMaxOutput: 16384, tokensPerImage: 2048 };
    expect(planCall({ ...big, promptTokens: 2000, images: 3, wantOutput: 6000, minOutput: 2500 })!.maxOutput).toBe(6000);
    expect(planCall({ ...big, promptTokens: 2000, images: 3, wantOutput: 50000, minOutput: 2500 })!.maxOutput).toBe(16384);
  });
});

describe('framesPerCall', () => {
  it('is one frame on Groq free and three on a large budget', () => {
    expect(framesPerCall({ tpm: 8000, tokensPerImage: 2048, maxImages: 3, promptTokens: 1600, minOutput: 2500 })).toBe(1);
    expect(framesPerCall({ tpm: 250000, tokensPerImage: 2048, maxImages: 3, promptTokens: 1600, minOutput: 2500 })).toBe(3);
  });

  it('is zero when not even one frame fits', () => {
    expect(framesPerCall({ tpm: 4000, tokensPerImage: 2048, maxImages: 3, promptTokens: 1600, minOutput: 2500 })).toBe(0);
  });
});

describe('parseDuration', () => {
  it('reads Groq reset strings', () => {
    expect(parseDuration('7.66s')).toBe(7660);
    expect(parseDuration('2m59.56s')).toBe(179560);
    expect(parseDuration('1h2m3s')).toBe(3723000);
    expect(parseDuration('120ms')).toBe(120);
  });

  it('treats a bare number as seconds', () => {
    expect(parseDuration('2')).toBe(2000);
  });

  it('returns null for missing or unreadable values', () => {
    expect(parseDuration(null)).toBeNull();
    expect(parseDuration('soon')).toBeNull();
  });
});

describe('readRateInfo', () => {
  it('reads the rate-limit headers', () => {
    const info = readRateInfo(
      new Headers({
        'retry-after': '2',
        'x-ratelimit-limit-tokens': '8000',
        'x-ratelimit-remaining-tokens': '352',
        'x-ratelimit-reset-tokens': '41.2s',
        'x-ratelimit-limit-requests': '1000',
        'x-ratelimit-remaining-requests': '993',
        'x-ratelimit-reset-requests': '2m59.56s',
      }),
    );
    expect(info).toEqual({
      retryAfterMs: 2000,
      limitTokens: 8000,
      remainingTokens: 352,
      resetTokensMs: 41200,
      limitRequests: 1000,
      remainingRequests: 993,
      resetRequestsMs: 179560,
    });
  });

  it('leaves absent headers undefined', () => {
    expect(readRateInfo(new Headers())).toEqual({});
  });
});

describe('waitBeforeCall', () => {
  it('waits for the token window when the next call would not fit', () => {
    expect(waitBeforeCall({ remainingTokens: 352, resetTokensMs: 41200 }, 7600)).toBe(41700);
  });

  it('does not wait when there is room or nothing is known', () => {
    expect(waitBeforeCall({ remainingTokens: 7900, resetTokensMs: 41200 }, 7600)).toBe(0);
    expect(waitBeforeCall(null, 7600)).toBe(0);
    expect(waitBeforeCall({}, 7600)).toBe(0);
  });

  it('waits when the daily request allowance is gone', () => {
    expect(waitBeforeCall({ remainingRequests: 0, resetRequestsMs: 60000, remainingTokens: 8000 }, 100)).toBe(60500);
  });
});
