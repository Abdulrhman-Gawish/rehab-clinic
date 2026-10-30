import { Injectable } from '@nestjs/common';
import { IsNull, type EntityManager } from 'typeorm';
import { ZERO } from '../../common/utils/money.util.js';
import {
  DefaultVisitBillingPolicy,
  type BillableItem,
  type VisitBillingPolicy,
} from '../billing/visit-billing-policy.js';
import { ClinicService } from '../clinic-services/entities/clinic-service.entity.js';
import type { Visit } from '../visits/entities/visit.entity.js';
import { PackageUsage } from './entities/package-usage.entity.js';

/**
 * A visit paid by a package session (its package_usages row is written just
 * before the invoice) gets one 0.00 line naming the package and the session;
 * any other visit is billed by the default policy.
 */
@Injectable()
export class PackageVisitBillingPolicy implements VisitBillingPolicy {
  private readonly fallback = new DefaultVisitBillingPolicy();

  async itemsFor(
    visit: Visit,
    manager: EntityManager,
  ): Promise<BillableItem[]> {
    const usage = await manager.findOne(PackageUsage, {
      where: { visitId: visit.id, restoredAt: IsNull() },
      relations: { patientPackage: true },
    });
    const pp = usage?.patientPackage;
    if (!pp) return this.fallback.itemsFor(visit, manager);

    const service = await manager.findOneByOrFail(ClinicService, {
      id: visit.serviceId,
    });
    return [
      {
        serviceId: service.id,
        description: `${service.name} — package ${pp.name} (session ${pp.usedSessions}/${pp.totalSessions})`,
        unitPrice: ZERO,
        quantity: 1,
      },
    ];
  }
}
