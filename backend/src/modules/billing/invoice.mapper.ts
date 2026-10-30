import type {
  InvoiceDetailDto,
  InvoiceDiscountDto,
  InvoiceItemDto,
  InvoicePaymentDto,
  InvoiceSummaryDto,
} from './dto/invoice.dto.js';
import type { InvoiceDiscount } from './entities/invoice-discount.entity.js';
import type { InvoiceItem } from './entities/invoice-item.entity.js';
import type { Payment } from './entities/payment.entity.js';
import type { Invoice } from './entities/invoice.entity.js';
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
export function toInvoiceDetail(
  invoice: Invoice,
  items: InvoiceItem[],
  discount: InvoiceDiscountDto | null,
  payments: InvoicePaymentDto[],
  isLocked: boolean,
  toIso: ToIso,
): InvoiceDetailDto {
  return {
    ...toInvoiceSummary(invoice, toIso),
    isLocked,
    canCancel:
      invoice.status !== InvoiceStatus.CANCELLED &&
      isZeroMoney(invoice.amountPaid),
    items: items.map(toInvoiceItem),
    discount,
    payments,
  };
}
