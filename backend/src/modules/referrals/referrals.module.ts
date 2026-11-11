import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AcquisitionModule } from '../acquisition/acquisition.module.js';
import { ExpensesModule } from '../expenses/expenses.module.js';
import { PatientReferralTerms } from './entities/patient-referral-terms.entity.js';
import { PatientReferral } from './entities/patient-referral.entity.js';
import { ReferralCommission } from './entities/referral-commission.entity.js';
import { ReferralPayoutAllocation } from './entities/referral-payout-allocation.entity.js';
import { ReferralPayout } from './entities/referral-payout.entity.js';
import { ReferringDoctorAgreement } from './entities/referring-doctor-agreement.entity.js';
import { ReferringDoctor } from './entities/referring-doctor.entity.js';
import { PatientReferralsService } from './patient-referrals.service.js';
import { ReferralCommissionsService } from './referral-commissions.service.js';
import { ReferralPayoutsService } from './referral-payouts.service.js';
import { ReferralReportsService } from './referral-reports.service.js';
import {
  PatientReferralsController,
  ReferralPayoutsController,
  ReferralReportsController,
  ReferringDoctorsController,
} from './referrals.controller.js';
import { ReferringDoctorsService } from './referring-doctors.service.js';

/**
 * Outside doctors who refer patients, their agreements, the patients'
 * terms, the commission ledger and payouts. Billing (attend, package sale,
 * payments) calls in with its own transaction's manager; nothing here
 * calls billing services. A payout writes its clinic expense through
 * ExpensesService in the payout's transaction.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      ReferringDoctor,
      ReferringDoctorAgreement,
      PatientReferral,
      PatientReferralTerms,
      ReferralCommission,
      ReferralPayout,
      ReferralPayoutAllocation,
    ]),
    AcquisitionModule,
    ExpensesModule,
  ],
  controllers: [
    ReferringDoctorsController,
    ReferralPayoutsController,
    PatientReferralsController,
    ReferralReportsController,
  ],
  providers: [
    ReferringDoctorsService,
    PatientReferralsService,
    ReferralCommissionsService,
    ReferralPayoutsService,
    ReferralReportsService,
  ],
  exports: [PatientReferralsService, ReferralCommissionsService],
})
export class ReferralsModule {}
