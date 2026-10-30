import type { VisitEventPayload } from '../visits/visit.events.js';
import type { InvoicesService } from './invoices.service.js';
import { VisitBillingListener } from './visit-billing.listener.js';

const payload = { visitId: 'v1' } as VisitEventPayload;

describe('VisitBillingListener shutdown', () => {
  it('waits for running handlers before the app shuts down', async () => {
    let finished = false;
    const invoices = {
      createForVisit: () =>
        new Promise((resolve) =>
          setTimeout(() => {
            finished = true;
            resolve(undefined);
          }, 50),
        ),
    } as unknown as InvoicesService;
    const listener = new VisitBillingListener(invoices);

    void listener.onCheckedIn(payload);
    await listener.beforeApplicationShutdown();

    expect(finished).toBe(true);
  });
});
