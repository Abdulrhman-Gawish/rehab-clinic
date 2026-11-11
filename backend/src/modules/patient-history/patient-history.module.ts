import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module.js';
import { ClinicalModule } from '../clinical/clinical.module.js';
import { PatientHistoryController } from './patient-history.controller.js';
import { PatientHistoryService } from './patient-history.service.js';
import { PatientTimelineService } from './patient-timeline.service.js';

// Read-only views over the other modules' tables: no entities of its own.
@Module({
  imports: [ClinicalModule, BillingModule],
  controllers: [PatientHistoryController],
  providers: [PatientHistoryService, PatientTimelineService],
})
export class PatientHistoryModule {}
