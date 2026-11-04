import { act } from 'react';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

export const flush = async (step: () => void = () => undefined): Promise<void> => {
  await act(async () => {
    step();
    await new Promise((done) => setTimeout(done, 0));
  });
};

// Outside act: act rethrows render errors instead of handing them to onUncaughtError.
export const withoutAct = async (step: () => void, settled: () => void): Promise<void> => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = false;
  try {
    step();
    const { vi } = await import('vitest');
    await vi.waitFor(settled);
  } finally {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  }
};
