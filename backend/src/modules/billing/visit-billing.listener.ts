import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { VisitEvent, type VisitEventPayload } from '../visits/visit.events.js';
import { InvoicesService } from './invoices.service.js';

/**
 * Billing side of the visit lifecycle. Visit events are emitted after the
 * visit transaction commits, and each handler runs its own transaction, so
 * a billing failure can never undo a check-in. Failures are logged with the
 * visitId; POST /visits/:id/invoice recovers.
 */
@Injectable()
export class VisitBillingListener {
  private readonly logger = new Logger(VisitBillingListener.name);

  constructor(private readonly invoices: InvoicesService) {}

  // Idempotent: replaying the event never creates a second invoice.
  @OnEvent(VisitEvent.CHECKED_IN, { async: true })
  async onCheckedIn(payload: VisitEventPayload): Promise<void> {
    try {
      await this.invoices.createForVisit(payload.visitId, {
        userId: null,
        ip: null,
      });
    } catch (error) {
      this.logger.error(
        `Automatic invoice failed for visit ${payload.visitId}: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  @OnEvent(VisitEvent.CANCELLED, { async: true })
  async onCancelled(payload: VisitEventPayload): Promise<void> {
    try {
      await this.invoices.cancelForCancelledVisit(payload.visitId);
    } catch (error) {
      this.logger.error(
        `Cancelling the invoice of visit ${payload.visitId} failed: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }
}
