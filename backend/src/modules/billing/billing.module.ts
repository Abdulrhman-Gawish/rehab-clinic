import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BillingReportsService } from './billing-reports.service.js';
import { DiscountsController } from './discounts.controller.js';
import { DiscountsService } from './discounts.service.js';
import { DocumentCounterService } from './document-counter.service.js';
import { Expense } from '../expenses/entities/expense.entity.js';
import { DocumentCounter } from './entities/document-counter.entity.js';
import { InvoiceDiscount } from './entities/invoice-discount.entity.js';
import { InvoiceItem } from './entities/invoice-item.entity.js';
import { Payment } from './entities/payment.entity.js';
import { Invoice } from './entities/invoice.entity.js';
import {
  InvoicesController,
  PatientBillingController,
} from './invoices.controller.js';
import { InvoicesService } from './invoices.service.js';
import { PaymentsController } from './payments.controller.js';
import { PaymentsService } from './payments.service.js';
import { PackageVisitBillingPolicy } from '../packages/package-billing-policy.js';
import { VISIT_BILLING_POLICY } from './visit-billing-policy.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Invoice,
      InvoiceItem,
      InvoiceDiscount,
      Payment,
      DocumentCounter,
      Expense,
    ]),
  ],
  controllers: [
    InvoicesController,
    PatientBillingController,
    DiscountsController,
    PaymentsController,
  ],
  providers: [
    DocumentCounterService,
    InvoicesService,
    DiscountsService,
    PaymentsService,
    BillingReportsService,
    // Package sessions are billed at 0.00; other visits at the doctor's price.
    { provide: VISIT_BILLING_POLICY, useClass: PackageVisitBillingPolicy },
  ],
  exports: [DocumentCounterService, InvoicesService, BillingReportsService],
})
export class BillingModule {}
