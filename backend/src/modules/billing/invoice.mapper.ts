import type {
  InvoiceDetailDto,
  InvoiceDiscountDto,
  InvoiceItemDto,
  InvoicePaymentDto,
  InvoiceSummaryDto,
} from './dto/invoice.dto.js';
import type { InvoiceDiscount } from './entities/invoice-discount.entity.js';
import type { InvoiceItem } from './entities/invoice-item.entity.js';
import type { Invoice } from './entities/invoice.entity.js';
import { balanceOf } from './invoice-math.js';

type ToIso = (instant: Date) => string;

// Requires `patient` to be loaded.
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
    balance: balanceOf(invoice.total, invoice.amountPaid),
    notes: invoice.notes,
    issuedById: invoice.issuedById,
    issuedAt: toIso(invoice.issuedAt),
    cancelledAt: invoice.cancelledAt ? toIso(invoice.cancelledAt) : null,
    cancelledById: invoice.cancelledById,
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
    appliedById: discount.appliedById,
    appliedAt: toIso(discount.appliedAt),
  };
}

export function toInvoiceDetail(
  invoice: Invoice,
  items: InvoiceItem[],
  discount: InvoiceDiscountDto | null,
  payments: InvoicePaymentDto[],
  toIso: ToIso,
): InvoiceDetailDto {
  return {
    ...toInvoiceSummary(invoice, toIso),
    items: items.map(toInvoiceItem),
    discount,
    payments,
  };
}
