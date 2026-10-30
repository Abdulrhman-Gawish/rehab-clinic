import { DiscountType } from '../billing/billing.enums.js';
import {
  isOfferActive,
  offerAmount,
  sellingPrice,
  type PackageOffer,
} from './package-price.js';

const offer = (overrides: Partial<PackageOffer> = {}): PackageOffer => ({
  type: DiscountType.PERCENT,
  value: '20',
  startsOn: '2026-11-01',
  endsOn: '2026-11-30',
  ...overrides,
});

describe('package price', () => {
  it('an offer is active between its dates, both inclusive', () => {
    expect(isOfferActive(offer(), '2026-10-31')).toBe(false);
    expect(isOfferActive(offer(), '2026-11-01')).toBe(true);
    expect(isOfferActive(offer(), '2026-11-30')).toBe(true);
    expect(isOfferActive(offer(), '2026-12-01')).toBe(false);
  });

  it('missing dates are open-ended; no offer is never active', () => {
    expect(isOfferActive(offer({ startsOn: null }), '2020-01-01')).toBe(true);
    expect(isOfferActive(offer({ endsOn: null }), '2099-01-01')).toBe(true);
    expect(isOfferActive(null, '2026-11-10')).toBe(false);
  });

  it('PERCENT takes a share of the price, rounded half up', () => {
    expect(offerAmount('1000.00', offer(), '2026-11-10')).toBe('200.00');
    expect(sellingPrice('1000.00', offer(), '2026-11-10')).toBe('800.00');
    expect(offerAmount('99.99', offer({ value: '12.5' }), '2026-11-10')).toBe(
      '12.50',
    );
  });

  it('FIXED takes the amount off; outside the dates the full price applies', () => {
    const fixed = offer({ type: DiscountType.FIXED, value: '150' });
    expect(sellingPrice('1000.00', fixed, '2026-11-10')).toBe('850.00');
    expect(sellingPrice('1000.00', fixed, '2026-12-10')).toBe('1000.00');
    expect(offerAmount('1000.00', fixed, '2026-12-10')).toBe('0.00');
  });
});
