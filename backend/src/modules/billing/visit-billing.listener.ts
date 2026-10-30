import {
  Injectable,
  Logger,
  type BeforeApplicationShutdown,
} from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { VisitEvent, type VisitEventPayload } from '../visits/visit.events.js';
import { InvoicesService } from './invoices.service.js';

const SHUTDOWN_TIMEOUT_MS = 10_000;

/**
 * Billing side of the visit lifecycle. Visit events are emitted after the
 * visit transaction commits, and each handler runs its own transaction, so
 * a billing failure can never undo a check-in. Failures are logged with the
 * visitId; POST /visits/:id/invoice recovers.
 *
 * On shutdown, handlers still running are awaited (up to 10 s) before the
 * database connection closes. beforeApplicationShutdown runs before every
 * onApplicationShutdown hook, including the one that closes TypeORM.
 */
@Injectable()
export class VisitBillingListener implements BeforeApplicationShutdown {
  private readonly logger = new Logger(VisitBillingListener.name);
  private readonly running = new Set<Promise<void>>();

  constructor(private readonly invoices: InvoicesService) {}

  // Idempotent: replaying the event never creates a second invoice.
  @OnEvent(VisitEvent.CHECKED_IN, { async: true })
  onCheckedIn(payload: VisitEventPayload): Promise<void> {
    return this.track(
      `Automatic invoice failed for visit ${payload.visitId}`,
      () => this.invoices.createForVisit(payload.visitId, SYSTEM_ACTOR),
    );
  }

  @OnEvent(VisitEvent.CANCELLED, { async: true })
  onCancelled(payload: VisitEventPayload): Promise<void> {
    return this.track(
      `Cancelling the invoice of visit ${payload.visitId} failed`,
      () => this.invoices.cancelForCancelledVisit(payload.visitId),
    );
  }

  async beforeApplicationShutdown(): Promise<void> {
    if (this.running.size === 0) return;
    let timer: NodeJS.Timeout | undefined;
    const timedOut = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), SHUTDOWN_TIMEOUT_MS);
    });
    const result = await Promise.race([
      Promise.allSettled(this.running),
      timedOut,
    ]);
    clearTimeout(timer);
    if (result === 'timeout') {
      this.logger.error(
        `Shutdown: ${this.running.size} billing handler(s) still running after ${SHUTDOWN_TIMEOUT_MS} ms were dropped; use POST /visits/:id/invoice to recover`,
      );
    }
  }

  // Runs a handler, logs (never rethrows) its failure, and remembers it
  // while it runs so shutdown can wait for it.
  private track(failure: string, work: () => Promise<unknown>): Promise<void> {
    const promise = work()
      .then(() => undefined)
      .catch((error: unknown) => {
        this.logger.error(
          `${failure}: ${error instanceof Error ? error.message : String(error)}`,
          error instanceof Error ? error.stack : undefined,
        );
      })
      .finally(() => this.running.delete(promise));
    this.running.add(promise);
    return promise;
  }
}

const SYSTEM_ACTOR = { userId: null, ip: null };
