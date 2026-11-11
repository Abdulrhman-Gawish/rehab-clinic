import { UserRefDto } from '../../common/dto/user-ref.dto.js';
import type {
  AgreementDto,
  CommissionDto,
  PatientReferralDto,
  PayoutDto,
  ReferralTermsDto,
  ReferringDoctorDto,
} from './dto/referrals.dto.js';
import type { PatientReferralTerms } from './entities/patient-referral-terms.entity.js';
import type { PatientReferral } from './entities/patient-referral.entity.js';
import type { ReferralCommission } from './entities/referral-commission.entity.js';
import type { ReferralPayout } from './entities/referral-payout.entity.js';
import type { ReferringDoctorAgreement } from './entities/referring-doctor-agreement.entity.js';
import type { ReferringDoctor } from './entities/referring-doctor.entity.js';
import type { RateRule } from './referral-math.js';
import type { ReferralRateType } from './referrals.enums.js';

type ToIso = (instant: Date) => string;

function loaded<T>(value: T | null | undefined, what: string): T {
  if (!value) throw new Error(`${what} relation is not loaded`);
  return value;
}

export const commissionRule = (row: {
  commissionType: ReferralRateType;
  commissionValue: string | null;
}): RateRule => ({ type: row.commissionType, value: row.commissionValue });

export const discountRule = (row: {
  discountType: ReferralRateType;
  discountValue: string | null;
}): RateRule => ({ type: row.discountType, value: row.discountValue });

export function toAgreement(
  agreement: ReferringDoctorAgreement,
  toIso: ToIso,
): AgreementDto {
  return {
    id: agreement.id,
    version: agreement.version,
    effectiveFrom: agreement.effectiveFrom,
    commission: commissionRule(agreement),
    discount: discountRule(agreement),
    notes: agreement.notes,
    createdBy: UserRefDto.fromEntity(agreement.createdBy),
    recordedAt: toIso(agreement.recordedAt),
  };
}

export function toReferringDoctor(
  doctor: ReferringDoctor,
  current: ReferringDoctorAgreement | null,
  upcoming: ReferringDoctorAgreement | null,
  toIso: ToIso,
): ReferringDoctorDto {
  return {
    id: doctor.id,
    name: doctor.name,
    phone: doctor.phone,
    specialty: doctor.specialty,
    workplace: doctor.workplace,
    notes: doctor.notes,
    isActive: doctor.isActive,
    currentAgreement: current ? toAgreement(current, toIso) : null,
    upcomingAgreement: upcoming ? toAgreement(upcoming, toIso) : null,
    createdAt: toIso(doctor.createdAt),
  };
}

export function toTerms(
  terms: PatientReferralTerms,
  toIso: ToIso,
): ReferralTermsDto {
  const agreement = loaded(terms.doctorAgreement, 'Doctor agreement');
  return {
    id: terms.id,
    version: terms.version,
    defaults: {
      agreementId: agreement.id,
      agreementVersion: agreement.version,
      commission: commissionRule(agreement),
      discount: discountRule(agreement),
    },
    commission: commissionRule(terms),
    discount: discountRule(terms),
    applicability: {
      type: terms.applicability,
      maxSessions: terms.maxSessions,
      validFrom: terms.validFrom,
      validTo: terms.validTo,
    },
    isOverride: terms.isOverride,
    overrideReason: terms.overrideReason,
    createdBy: UserRefDto.fromEntity(terms.createdBy),
    recordedAt: toIso(terms.recordedAt),
  };
}

// `history` newest first (non-empty: a referral always has version 1).
export function toPatientReferral(
  referral: PatientReferral,
  history: PatientReferralTerms[],
  coveredSessions: number,
  toIso: ToIso,
): PatientReferralDto {
  const patient = loaded(referral.patient, 'Patient');
  const doctor = loaded(referral.referringDoctor, 'Referring doctor');
  const terms = history.map((t) => toTerms(t, toIso));
  return {
    id: referral.id,
    patient: { id: patient.id, name: patient.name },
    referringDoctor: {
      id: doctor.id,
      name: doctor.name,
      isActive: doctor.isActive,
    },
    status: referral.status,
    assignedBy: UserRefDto.fromEntity(referral.assignedBy),
    assignedAt: toIso(referral.assignedAt),
    endedAt: referral.endedAt ? toIso(referral.endedAt) : null,
    endedBy: UserRefDto.fromNullable(referral.endedBy),
    endReason: referral.endReason,
    coveredSessions,
    terms: loaded(terms[0], 'Referral terms'),
    history: terms,
  };
}

const paymentRef = (
  payment: ReferralCommission['payment'],
): CommissionDto['payment'] =>
  payment
    ? {
        id: payment.id,
        receiptNumber: payment.receiptNumber,
        type: payment.type,
      }
    : null;

// `paidAmount`: what valid payouts settled of the row.
export function toCommission(
  row: ReferralCommission,
  paidAmount: string,
  toIso: ToIso,
): CommissionDto {
  const doctor = loaded(row.referringDoctor, 'Referring doctor');
  return {
    id: row.id,
    referringDoctor: { id: doctor.id, name: doctor.name },
    kind: row.kind,
    status: row.status,
    amount: row.amount,
    commissionType: row.commissionType,
    rate: row.rate,
    baseAmount: row.baseAmount,
    patient: row.patient
      ? { id: row.patient.id, name: row.patient.name }
      : null,
    invoice: row.invoice
      ? { id: row.invoice.id, invoiceNumber: row.invoice.invoiceNumber }
      : null,
    visitId: row.visitId,
    payment: paymentRef(row.payment),
    sourcePayment: paymentRef(row.sourcePayment),
    referralTermsId: row.referralTermsId,
    termsVersion: row.referralTerms?.version ?? null,
    paidAmount,
    payoutId: row.payoutId,
    reason: row.reason,
    recordedBy: UserRefDto.fromEntity(row.recordedBy),
    recordedAt: toIso(row.recordedAt),
    eligibleAt: row.eligibleAt ? toIso(row.eligibleAt) : null,
  };
}

export function toPayout(
  payout: ReferralPayout,
  commissionCount: number,
  toIso: ToIso,
): PayoutDto {
  const doctor = loaded(payout.referringDoctor, 'Referring doctor');
  const expense = loaded(payout.expense, 'Expense');
  return {
    id: payout.id,
    referringDoctor: { id: doctor.id, name: doctor.name },
    amount: payout.amount,
    payoutDate: payout.payoutDate,
    method: payout.method,
    reference: payout.reference,
    notes: payout.notes,
    status: payout.status,
    expense: { id: expense.id, expenseNumber: expense.expenseNumber },
    paidBy: UserRefDto.fromEntity(payout.paidBy),
    paidAt: toIso(payout.paidAt),
    voidedAt: payout.voidedAt ? toIso(payout.voidedAt) : null,
    voidedBy: UserRefDto.fromNullable(payout.voidedBy),
    voidReason: payout.voidReason,
    commissionCount,
  };
}
