import { Module } from '@nestjs/common';
import { DocumentCounterService } from './document-counter.service.js';

// Gapless document numbers, in their own module so ExpensesModule (used by
// ReferralsModule for payout expenses) needs no BillingModule, which
// imports ReferralsModule.
@Module({
  providers: [DocumentCounterService],
  exports: [DocumentCounterService],
})
export class DocumentCounterModule {}
