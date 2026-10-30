import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { toMoney } from '../../common/utils/money.util.js';
import { ClinicService } from '../clinic-services/entities/clinic-service.entity.js';
import { DoctorClinicService } from '../doctors/entities/doctor-clinic-service.entity.js';
import type { Visit } from '../visits/entities/visit.entity.js';

/**
 * Decides what a visit's automatic invoice contains. BillingModule binds
 * PackageVisitBillingPolicy (packages module): a visit paid by a package
 * session gets a 0.00 line, everything else falls back to the default.
 */
export const VISIT_BILLING_POLICY = Symbol('VISIT_BILLING_POLICY');

export interface BillableItem {
  serviceId: string | null;
  description: string;
  // 2-decimal money string, snapshotted into the invoice.
  unitPrice: string;
  quantity: number;
}

export interface VisitBillingPolicy {
  itemsFor(visit: Visit, manager: EntityManager): Promise<BillableItem[]>;
}

// Default: one line for the visit's service at the doctor's price
// (doctor_services.price_override ?? clinic_services.base_price).
@Injectable()
export class DefaultVisitBillingPolicy implements VisitBillingPolicy {
  async itemsFor(
    visit: Visit,
    manager: EntityManager,
  ): Promise<BillableItem[]> {
    const service = await manager
      .getRepository(ClinicService)
      .findOneByOrFail({ id: visit.serviceId });
    const assignment = await manager
      .getRepository(DoctorClinicService)
      .findOneBy({
        doctorId: visit.doctorId,
        serviceId: visit.serviceId,
      });
    return [
      {
        serviceId: service.id,
        description: service.name,
        unitPrice: toMoney(assignment?.priceOverride ?? service.basePrice),
        quantity: 1,
      },
    ];
  }
}
