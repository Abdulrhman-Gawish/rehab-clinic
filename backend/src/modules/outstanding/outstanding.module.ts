import { Module } from '@nestjs/common';
import { OutstandingService } from './outstanding.service.js';

/**
 * Outstanding balances at the end of any local day (read-only queries over
 * billing, salaries and referral tables). Imports no other feature module,
 * so billing (daily summary) and reports can both use it.
 */
@Module({
  providers: [OutstandingService],
  exports: [OutstandingService],
})
export class OutstandingModule {}
