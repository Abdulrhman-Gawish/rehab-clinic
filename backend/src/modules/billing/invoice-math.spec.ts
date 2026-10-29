import { AppException } from '../../common/errors/app.exception.js';
import { DiscountType, InvoiceStatus } from './billing.enums.js';
import {
  assertEditable,
  balanceOf,
  computeTotals,
  deriveInvoiceStatus,
  discountAmount,
} from './invoice-math.js';

const pct = (value: string) => ({ type: DiscountType.PERCENT, value });
const fixed = (value: string) => ({ type: DiscountType.FIXED, value });

describe('invoice math', () => {
  it('sums several items exactly', () => {
    expect(
      computeTotals(
        [
          { unitPrice: '320.00', quantity: 1 },
          { unitPrice: '0.10', quantity: 3 },
          { unitPrice: '33.33', quantity: 3 },
        ],
        null,
      ),
    ).toEqual({ subtotal: '420.29', discountTotal: '0.00', total: '420.29' });
  });

  it.each([
    // [subtotal, percent, discount, total]
    ['100.00', '33.33', '33.33', '66.67'],
    ['99.99', '12.5', '12.50', '87.49'],
    ['99.99', '33.33', '33.33', '66.66'],
    ['10.00', '33.33', '3.33', '6.67'],
    ['0.05', '50', '0.03', '0.02'],
    ['320.00', '100', '320.00', '0.00'],
  ])(
    '%s with %s%% off -> discount %s, total %s',
    (subtotal, percent, discount, total) => {
      expect(
        computeTotals([{ unitPrice: subtotal, quantity: 1 }], pct(percent)),
      ).toEqual({ subtotal, discountTotal: discount, total });
    },
  );

  it('fixed discount equal to the subtotal is fine, above it is rejected', () => {
    expect(discountAmount('50.00', fixed('50'))).toBe('50.00');
    try {
      discountAmount('50.00', fixed('50.01'));
      expect.unreachable();
    } catch (error) {
      expect((error as AppException).code).toBe('DISCOUNT_EXCEEDS_SUBTOTAL');
      expect((error as AppException).getStatus()).toBe(422);
    }
  });

  it('percent discount follows the subtotal when items change', () => {
    const before = computeTotals(
      [{ unitPrice: '200.00', quantity: 1 }],
      pct('10'),
    );
    const after = computeTotals(
      [
        { unitPrice: '200.00', quantity: 1 },
        { unitPrice: '99.99', quantity: 1 },
      ],
      pct('10'),
    );
    expect(before.discountTotal).toBe('20.00');
    expect(after).toEqual({
      subtotal: '299.99',
      discountTotal: '30.00',
      total: '269.99',
    });
  });

  it.each([
    ['100.00', '0.00', InvoiceStatus.ISSUED],
    ['100.00', '0.01', InvoiceStatus.PARTIALLY_PAID],
    ['100.00', '99.99', InvoiceStatus.PARTIALLY_PAID],
    ['100.00', '100.00', InvoiceStatus.PAID],
    ['0.00', '0.00', InvoiceStatus.PAID],
  ])('total %s, paid %s -> %s', (total, paid, status) => {
    expect(deriveInvoiceStatus(total, paid)).toBe(status);
  });

  it('balance', () => {
    expect(balanceOf('256.00', '100.50')).toBe('155.50');
  });

  it('invoices are editable only while unpaid and not cancelled', () => {
    expect(() =>
      assertEditable({ status: InvoiceStatus.ISSUED, amountPaid: '0.00' }),
    ).not.toThrow();
    for (const invoice of [
      { status: InvoiceStatus.PARTIALLY_PAID, amountPaid: '10.00' },
      { status: InvoiceStatus.CANCELLED, amountPaid: '0.00' },
    ]) {
      expect(() => assertEditable(invoice)).toThrow(
        expect.objectContaining({ code: 'INVOICE_LOCKED' }),
      );
    }
  });
});
