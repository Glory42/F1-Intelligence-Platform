import { describe, expect, it } from 'vitest';
import { missingPageStatus, trackRenderHealth } from '@/lib/renderHealth';
import { isTransientApiStatus, reportApiFailure } from '@/lib/apiFailure';

describe('render health', () => {
  it('marks only the render whose API call failed', async () => {
    const [failed, clean] = await Promise.all([
      trackRenderHealth(async (health) => {
        await Promise.resolve();
        reportApiFailure();
        return health.degraded;
      }),
      trackRenderHealth(async (health) => {
        await Promise.resolve();
        return health.degraded;
      }),
    ]);

    expect(failed).toBe(true);
    expect(clean).toBe(false);
  });

  it('answers 404 for a missing record the API reported as not found', async () => {
    const status = await trackRenderHealth(async () => missingPageStatus(false));

    expect(status).toBe(404);
  });

  it('answers 503 for a missing record when the API could not be reached', async () => {
    const status = await trackRenderHealth(async () => {
      reportApiFailure();
      return missingPageStatus(false);
    });

    expect(status).toBe(503);
  });

  it('answers 200 when the record is there', async () => {
    expect(await trackRenderHealth(async () => missingPageStatus(true))).toBe(200);
  });

  it.each([
    [500, true], [503, true], [429, true], [404, false], [400, false],
  ])('treats API status %i as transient: %s', (status, transient) => {
    expect(isTransientApiStatus(status)).toBe(transient);
  });
});
