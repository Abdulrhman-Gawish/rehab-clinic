import type {
  CorrectionDiscountDto,
  InvoiceCorrectionSideDto,
  InvoiceDetailDto,
  InvoiceDiscountDto,
  InvoiceItemDto,
  InvoicePaymentDto,
  InvoiceRefDto,
  InvoiceSummaryDto,
} from './dto/invoice.dto.js';
import type { InvoiceDiscount } from './entities/invoice-discount.entity.js';
import type { InvoiceItem } from './entities/invoice-item.entity.js';
import type { Payment } from './entities/payment.entity.js';
import type { Invoice } from './entities/invoice.entity.js';
import type { InvoiceReferralDto } from '../referrals/dto/referrals.dto.js';
import type { PatientReferralTerms } from '../referrals/entities/patient-referral-terms.entity.js';
import { UserRefDto } from '../../common/dto/user-ref.dto.js';
import { isZeroMoney, subMoney } from '../../common/utils/money.util.js';
import { InvoiceStatus } from './billing.enums.js';

type ToIso = (instant: Date) => string;

// Requires `patient`, `issuedBy` and `cancelledBy` to be loaded.
export function toInvoiceSummary(
  invoice: Invoice,
  toIso: ToIso,
): InvoiceSummaryDto {
  const { patient } = invoice;
  if (!patient) throw new Error('Invoice patient is not loaded');
  return {
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    status: invoice.status,
    patient: { id: patient.id, name: patient.name, phone: patient.phone },
    visitId: invoice.visitId,
    subtotal: invoice.subtotal,
    discountTotal: invoice.discountTotal,
    total: invoice.total,
    amountPaid: invoice.amountPaid,
    balance: subMoney(invoice.total, invoice.amountPaid),
    notes: invoice.notes,
    issuedBy: UserRefDto.fromNullable(invoice.issuedBy),
    issuedAt: toIso(invoice.issuedAt),
    cancelledAt: invoice.cancelledAt ? toIso(invoice.cancelledAt) : null,
    cancelledBy: UserRefDto.fromNullable(invoice.cancelledBy),
    cancelReason: invoice.cancelReason,
  };
}

export function toInvoiceItem(item: InvoiceItem): InvoiceItemDto {
  return {
    id: item.id,
    serviceId: item.serviceId,
    description: item.description,
    unitPrice: item.unitPrice,
    quantity: item.quantity,
    lineTotal: item.lineTotal,
  };
}

// Requires `appliedBy` to be loaded.
export function toInvoiceDiscount(
  discount: InvoiceDiscount,
  toIso: ToIso,
): InvoiceDiscountDto {
  return {
    id: discount.id,
    type: discount.type,
    value: discount.value,
    amount: discount.amount,
    reason: discount.reason,
    repeatedFromId: discount.repeatedFromId,
    referralTermsId: discount.referralTermsId,
    appliedBy: UserRefDto.fromEntity(discount.appliedBy),
    appliedAt: toIso(discount.appliedAt),
  };
}

// Requires `receivedBy` to be loaded.
export function toInvoicePayment(
  payment: Payment,
  toIso: ToIso,
): InvoicePaymentDto {
  return {
    id: payment.id,
    receiptNumber: payment.receiptNumber,
    type: payment.type,
    status: payment.status,
    amount: payment.amount,
    method: payment.method,
    reference: payment.reference,
    refundOfId: payment.refundOfId,
    receivedBy: UserRefDto.fromEntity(payment.receivedBy),
    receivedAt: toIso(payment.receivedAt),
  };
}

// `isLocked`: see InvoicesService.isLocked (the one definition of the rule).
// `canCorrect` / `canReissue`: see replacementOption (invoice-math.ts).
export function toInvoiceDetail(
  invoice: Invoice,
  items: InvoiceItem[],
  discount: InvoiceDiscountDto | null,
  payments: InvoicePaymentDto[],
  isLocked: boolean,
  referral: InvoiceReferralDto | null,
  correction: {
    canCorrect: boolean;
    canReissue: boolean;
    replacesInvoice: InvoiceRefDto | null;
    replacedBy: InvoiceRefDto | null;
  },
  toIso: ToIso,
): InvoiceDetailDto {
  return {
    ...toInvoiceSummary(invoice, toIso),
    isLocked,
    canCancel:
      invoice.status !== InvoiceStatus.CANCELLED &&
      isZeroMoney(invoice.amountPaid),
    ...correction,
    items: items.map(toInvoiceItem),
    discount,
    payments,
    referral,
  };
}

export const toInvoiceRef = (
  invoice: Pick<Invoice, 'id' | 'invoiceNumber'>,
): InvoiceRefDto => ({ id: invoice.id, invoiceNumber: invoice.invoiceNumber });

// One side of a replacement preview. `terms` as for toInvoiceReferral.
export function toCorrectionSide(
  amounts: Pick<Invoice, 'subtotal' | 'discountTotal' | 'total'>,
  terms: PatientReferralTerms | null,
  discount: CorrectionDiscountDto | null,
): InvoiceCorrectionSideDto {
  return {
    referral: terms ? toInvoiceReferral(terms) : null,
    discount: discount && {
      type: discount.type,
      value: discount.value,
      amount: discount.amount,
      reason: discount.reason,
    },
    subtotal: amounts.subtotal,
    discountTotal: amounts.discountTotal,
    total: amounts.total,
  };
}

// Requires `patientReferral.referringDoctor` to be loaded.
export function toInvoiceReferral(
  terms: PatientReferralTerms,
): InvoiceReferralDto {
  const referral = terms.patientReferral;
  const doctor = referral?.referringDoctor;
  if (!referral || !doctor) {
    throw new Error('Referral relations are not loaded');
  }
  return {
    referralId: referral.id,
    termsId: terms.id,
    termsVersion: terms.version,
    referringDoctor: { id: doctor.id, name: doctor.name },
    isOverride: terms.isOverride,
  };
}
