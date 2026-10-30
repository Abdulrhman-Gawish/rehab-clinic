import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BillingModule } from '../billing/billing.module.js';
import { ClinicalModule } from '../clinical/clinical.module.js';
import { PackageDoctor } from './entities/package-doctor.entity.js';
import { PackageUsage } from './entities/package-usage.entity.js';
import { Package } from './entities/package.entity.js';
import { PatientPackage } from './entities/patient-package.entity.js';
import {
  PackagesController,
  PatientPackagesController,
  PublicPackagesController,
} from './packages.controller.js';
import { PackagesService } from './packages.service.js';
import { PatientPackagesService } from './patient-packages.service.js';

// Attend, walk-in and no-show use sessions through PatientPackagesService
// (in their own transaction); the 0.00 invoice line comes from
// PackageVisitBillingPolicy, bound in BillingModule.
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Package,
      PackageDoctor,
      PatientPackage,
      PackageUsage,
    ]),
    BillingModule,
    ClinicalModule,
  ],
  controllers: [
    PackagesController,
    PublicPackagesController,
    PatientPackagesController,
  ],
  providers: [PackagesService, PatientPackagesService],
  exports: [PatientPackagesService],
})
export class PackagesModule {}
