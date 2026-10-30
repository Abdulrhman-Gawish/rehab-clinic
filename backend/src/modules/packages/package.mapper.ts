import { UserRefDto } from '../../common/dto/user-ref.dto.js';
import { subMoney, ZERO } from '../../common/utils/money.util.js';
import { InvoiceStatus } from '../billing/billing.enums.js';
import type { Invoice } from '../billing/entities/invoice.entity.js';
import type {
  PackageResponseDto,
  PackageSessionDto,
  PackageUsageDto,
  PatientPackageDto,
  PublicPackageDto,
} from './dto/package.dto.js';
import type { PackageUsage } from './entities/package-usage.entity.js';
import type { Package } from './entities/package.entity.js';
import type { PatientPackage } from './entities/patient-package.entity.js';
import {
  isOfferActive,
  sellingPrice,
  type PackageOffer,
} from './package-price.js';

type ToIso = (instant: Date) => string;

export function offerOf(pkg: Package): PackageOffer | null {
  return pkg.offerType && pkg.offerValue
    ? {
        type: pkg.offerType,
        value: pkg.offerValue,
        startsOn: pkg.offerStartsOn,
        endsOn: pkg.offerEndsOn,
      }
    : null;
}

// Requires doctors.doctor.user to be loaded (empty list when allDoctors).
function doctorRefs(pkg: Package): UserRefDto[] {
  if (pkg.allDoctors) return [];
  if (!pkg.doctors) throw new Error('Package doctors are not loaded');
  return pkg.doctors
    .map((link) => {
      if (!link.doctor?.user) throw new Error('Doctor relation is not loaded');
      return { id: link.doctor.id, name: link.doctor.user.name };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

// Requires service and doctors.doctor.user. `today`: clinic local date.
export function toPackageResponse(
  pkg: Package,
  today: string,
): PackageResponseDto {
  if (!pkg.service) throw new Error('Package service is not loaded');
  const offer = offerOf(pkg);
  return {
    id: pkg.id,
    name: pkg.name,
    service: { id: pkg.service.id, name: pkg.service.name },
    sessionsCount: pkg.sessionsCount,
    price: pkg.price,
    offer,
    offerActive: isOfferActive(offer, today),
    sellingPrice: sellingPrice(pkg.price, offer, today),
    allDoctors: pkg.allDoctors,
    doctors: doctorRefs(pkg),
    isPublic: pkg.isPublic,
    isActive: pkg.isActive,
    createdAt: pkg.createdAt,
    updatedAt: pkg.updatedAt,
  };
}

// Requires service.
export function toPublicPackage(pkg: Package, today: string): PublicPackageDto {
  if (!pkg.service) throw new Error('Package service is not loaded');
  const offer = offerOf(pkg);
  const active = isOfferActive(offer, today);
  return {
    id: pkg.id,
    name: pkg.name,
    service: { id: pkg.service.id, name: pkg.service.name },
    sessionsCount: pkg.sessionsCount,
    price: pkg.price,
    sellingPrice: sellingPrice(pkg.price, offer, today),
    offerEndsOn: active ? (offer?.endsOn ?? null) : null,
  };
}

/**
 * Requires service, soldBy, cancelledBy and package.doctors.doctor.user.
 * `invoice` is null for a doctor: the price columns are left out.
 */
export function toPatientPackage(
  pp: PatientPackage,
  invoice: Invoice | null,
  toIso: ToIso,
): PatientPackageDto {
  if (!pp.service || !pp.package) {
    throw new Error('Patient package relations are not loaded');
  }
  const dto: PatientPackageDto = {
    id: pp.id,
    packageId: pp.packageId,
    name: pp.name,
    service: { id: pp.service.id, name: pp.service.name },
    totalSessions: pp.totalSessions,
    usedSessions: pp.usedSessions,
    sessionsLeft: pp.totalSessions - pp.usedSessions,
    status: pp.status,
    allDoctors: pp.package.allDoctors,
    doctors: doctorRefs(pp.package),
    soldAt: toIso(pp.soldAt),
    soldBy: UserRefDto.fromEntity(pp.soldBy),
    cancelledAt: pp.cancelledAt ? toIso(pp.cancelledAt) : null,
    cancelledBy: UserRefDto.fromNullable(pp.cancelledBy),
    cancelReason: pp.cancelReason,
  };
  if (!invoice) return dto;
  const cancelled = invoice.status === InvoiceStatus.CANCELLED;
  return {
    ...dto,
    listPrice: pp.listPrice,
    offerAmount: pp.offerAmount,
    price: pp.price,
    invoiceId: invoice.id,
    invoiceTotal: invoice.total,
    amountPaid: invoice.amountPaid,
    balance: cancelled ? ZERO : subMoney(invoice.total, invoice.amountPaid),
  };
}

// Requires usedBy, restoredBy and visit.doctor.user / appointment.doctor.user.
export function toPackageUsage(
  usage: PackageUsage,
  toIso: ToIso,
): PackageUsageDto {
  const doctor = usage.visit?.doctor ?? usage.appointment?.doctor;
  if (!doctor?.user) throw new Error('Usage doctor is not loaded');
  return {
    id: usage.id,
    reason: usage.reason,
    usedAt: toIso(usage.usedAt),
    usedBy: UserRefDto.fromEntity(usage.usedBy),
    doctor: { id: doctor.id, name: doctor.user.name },
    visitId: usage.visitId,
    appointmentId: usage.appointmentId,
    restored: usage.restoredAt !== null,
    restoredAt: usage.restoredAt ? toIso(usage.restoredAt) : null,
    restoredBy: UserRefDto.fromNullable(usage.restoredBy),
    restoreReason: usage.restoreReason,
  };
}

// Requires patientPackage.
export function toPackageSession(usage: PackageUsage): PackageSessionDto {
  const pp = usage.patientPackage;
  if (!pp) throw new Error('Usage patient package is not loaded');
  return {
    usageId: usage.id,
    patientPackageId: pp.id,
    name: pp.name,
    used: pp.usedSessions,
    total: pp.totalSessions,
  };
}
