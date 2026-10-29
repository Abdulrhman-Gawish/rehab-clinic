import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DocumentCounterService } from './document-counter.service.js';
import { DocumentCounter } from './entities/document-counter.entity.js';
import { InvoiceItem } from './entities/invoice-item.entity.js';
import { Invoice } from './entities/invoice.entity.js';
import {
  InvoicesController,
  PatientBillingController,
  VisitInvoiceController,
} from './invoices.controller.js';
import { InvoicesService } from './invoices.service.js';
import {
  DefaultVisitBillingPolicy,
  VISIT_BILLING_POLICY,
} from './visit-billing-policy.js';
import { VisitBillingListener } from './visit-billing.listener.js';

@Module({
  imports: [TypeOrmModule.forFeature([Invoice, InvoiceItem, DocumentCounter])],
  controllers: [
    InvoicesController,
    PatientBillingController,
    VisitInvoiceController,
  ],
  providers: [
    DocumentCounterService,
    InvoicesService,
    VisitBillingListener,
    // Stage 8 (packages) binds a policy returning covered items at 0.00.
    { provide: VISIT_BILLING_POLICY, useClass: DefaultVisitBillingPolicy },
  ],
  exports: [DocumentCounterService, InvoicesService],
})
export class BillingModule {}
