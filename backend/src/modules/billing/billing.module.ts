import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BillingReportsService } from './billing-reports.service.js';
import { DiscountsController } from './discounts.controller.js';
import { DiscountsService } from './discounts.service.js';
import { DocumentCounterModule } from './document-counter.module.js';
import { Expense } from '../expenses/entities/expense.entity.js';
import { DocumentCounter } from './entities/document-counter.entity.js';
import { InvoiceDiscount } from './entities/invoice-discount.entity.js';
import { InvoiceItem } from './entities/invoice-item.entity.js';
import { Payment } from './entities/payment.entity.js';
import { Invoice } from './entities/invoice.entity.js';
import { InvoiceReplacementsService } from './invoice-replacements.service.js';
import {
  InvoicesController,
  PatientBillingController,
} from './invoices.controller.js';
import { InvoicesService } from './invoices.service.js';
import { PaymentsController } from './payments.controller.js';
import { PaymentsService } from './payments.service.js';
import { PackageVisitBillingPolicy } from '../packages/package-billing-policy.js';
import { ReferralsModule } from '../referrals/referrals.module.js';
import { VISIT_BILLING_POLICY } from './visit-billing-policy.js';

// Doctor referrals: invoices are covered (terms + discount) through
// DiscountsService.applyReferral, and every payment, refund and void writes
// its commission row through ReferralCommissionsService, in the same
// transaction.
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
    ReferralsModule,
    DocumentCounterModule,
  ],
  controllers: [
    InvoicesController,
    PatientBillingController,
    DiscountsController,
    PaymentsController,
  ],
  providers: [
    InvoicesService,
    DiscountsService,
    InvoiceReplacementsService,
    PaymentsService,
    BillingReportsService,
    // Package sessions are billed at 0.00; other visits at the doctor's price.
    { provide: VISIT_BILLING_POLICY, useClass: PackageVisitBillingPolicy },
  ],
  exports: [InvoicesService, DiscountsService, BillingReportsService],
})
export class BillingModule {}
