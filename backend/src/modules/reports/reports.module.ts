import { Module } from '@nestjs/common';
import { OutstandingModule } from '../outstanding/outstanding.module.js';
import { ReportsController } from './reports.controller.js';
import { ReportsService } from './reports.service.js';

// Read-only aggregate queries over the other modules' tables; outstanding
// balances come from OutstandingModule (shared with the daily summary).
@Module({
  imports: [OutstandingModule],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
