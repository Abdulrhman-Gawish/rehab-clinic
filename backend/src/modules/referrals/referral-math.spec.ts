import { BadRequestException } from '@nestjs/common';
import { addMoney } from '../../common/utils/money.util.js';
import { DiscountType } from '../billing/billing.enums.js';
import {
  allocatePayout,
  commissionDelta,
  commissionTarget,
  coversSession,
  currentAgreement,
  isOverride,
  normalizeApplicability,
  normalizeRate,
  referralDiscountRule,
  type Applicability,
  type RateRule,
} from './referral-math.js';
import { ReferralApplicability, ReferralRateType } from './referrals.enums.js';

const { NONE, PERCENT, FIXED } = ReferralRateType;
const percent = (value: string): RateRule => ({ type: PERCENT, value });
const fixed = (value: string): RateRule => ({ type: FIXED, value });
const none: RateRule = { type: NONE, value: null };

/**
 * Replays payment events on one invoice the way the ledger does: after each
 * event the new row is target(net collected) - rows so far.
 */
function ledger(rule: RateRule, total: string, netAfterEachEvent: string[]) {
  const rows: string[] = [];
  for (const net of netAfterEachEvent) {
    const delta = commissionDelta(rule, net, total, addMoney('0', ...rows));
    if (delta !== '0.00') rows.push(delta);
  }
  return rows;
}

describe('referral-math', () => {
  describe('commissionTarget', () => {
    it('PERCENT is the rate applied to the money collected', () => {
      expect(commissionTarget(percent('10'), '900.00', '900.00')).toBe('90.00');
      expect(commissionTarget(percent('12.5'), '99.99', '99.99')).toBe('12.50');
    });

    it('FIXED is earned in proportion to the part of the total collected', () => {
      expect(commissionTarget(fixed('50'), '300.00', '900.00')).toBe('16.67');
      expect(commissionTarget(fixed('50'), '900.00', '900.00')).toBe('50.00');
    });

    it('FIXED earns nothing on a 0.00 invoice and never more than the fixed amount', () => {
      expect(commissionTarget(fixed('50'), '0.00', '0.00')).toBe('0.00');
      expect(commissionTarget(fixed('50'), '1000.00', '900.00')).toBe('50.00');
    });

    it('NONE earns nothing', () => {
      expect(commissionTarget(none, '900.00', '900.00')).toBe('0.00');
    });
  });

  describe('ledger over partial payments', () => {
    it('1000 session, 100 discount, 10%: three payments of 300 earn 30 each (90 total)', () => {
      // The invoice total is after the discount: 1000 - 100 = 900.
      const rows = ledger(percent('10'), '900.00', [
        '300.00',
        '600.00',
        '900.00',
      ]);
      expect(rows).toEqual(['30.00', '30.00', '30.00']);
    });

    it('FIXED over three payments adds up to the fixed amount exactly', () => {
      const rows = ledger(fixed('50'), '900.00', [
        '300.00',
        '600.00',
        '900.00',
      ]);
      expect(rows).toEqual(['16.67', '16.66', '16.67']);
      expect(addMoney(...rows)).toBe('50.00');
    });

    it('cumulative rounding: two 0.05 payments at 10% earn 0.01, not 0.02', () => {
      const rows = ledger(percent('10'), '0.10', ['0.05', '0.10']);
      expect(addMoney(...rows)).toBe('0.01');
    });

    it('a partial refund reverses its share', () => {
      // Paid 300, then 100 of it refunded.
      const rows = ledger(percent('10'), '900.00', ['300.00', '200.00']);
      expect(rows).toEqual(['30.00', '-10.00']);
    });

    it('a full refund brings the commission back to 0.00 exactly', () => {
      const rows = ledger(percent('10'), '333.33', [
        '333.33',
        '233.33',
        '0.00',
      ]);
      expect(rows).toEqual(['33.33', '-10.00', '-23.33']);
      expect(addMoney(...rows)).toBe('0.00');
    });

    it('FIXED: a full refund of a partly paid session reverses all of it', () => {
      const rows = ledger(fixed('50'), '900.00', ['300.00', '0.00']);
      expect(rows).toEqual(['16.67', '-16.67']);
    });

    it('a voided refund restores the commission', () => {
      const rows = ledger(percent('10'), '900.00', [
        '900.00',
        '500.00',
        '900.00',
      ]);
      expect(rows).toEqual(['90.00', '-40.00', '40.00']);
    });

    it('replaying the same state adds nothing (idempotent)', () => {
      const rows = ledger(percent('10'), '900.00', ['300.00', '300.00']);
      expect(rows).toEqual(['30.00']);
    });
  });

  describe('referralDiscountRule', () => {
    it('PERCENT gives the percentage', () => {
      expect(referralDiscountRule(percent('10'), '1000.00')).toEqual({
        type: DiscountType.PERCENT,
        value: '10',
      });
    });

    it('FIXED is capped at the subtotal', () => {
      expect(referralDiscountRule(fixed('100.00'), '1000.00')).toEqual({
        type: DiscountType.FIXED,
        value: '100.00',
      });
      expect(referralDiscountRule(fixed('100.00'), '80.00')).toEqual({
        type: DiscountType.FIXED,
        value: '80.00',
      });
    });

    it('nothing for NONE or a 0.00 subtotal', () => {
      expect(referralDiscountRule(none, '1000.00')).toBeNull();
      expect(referralDiscountRule(percent('10'), '0.00')).toBeNull();
    });
  });

  describe('coversSession', () => {
    const terms = (over: Partial<Applicability>): Applicability => ({
      applicability: ReferralApplicability.ALL_SESSIONS,
      maxSessions: null,
      validFrom: null,
      validTo: null,
      ...over,
    });

    it('FIRST_SESSION covers only the first one', () => {
      const t = terms({ applicability: ReferralApplicability.FIRST_SESSION });
      expect(coversSession(t, 0, '2026-11-03')).toBe(true);
      expect(coversSession(t, 1, '2026-11-03')).toBe(false);
    });

    it('SESSION_COUNT covers up to the number', () => {
      const t = terms({
        applicability: ReferralApplicability.SESSION_COUNT,
        maxSessions: 3,
      });
      expect(coversSession(t, 2, '2026-11-03')).toBe(true);
      expect(coversSession(t, 3, '2026-11-03')).toBe(false);
    });

    it('ALL_SESSIONS always covers', () => {
      expect(coversSession(terms({}), 99, '2030-01-01')).toBe(true);
    });

    it('DATE_RANGE covers local dates inside the range, both ends included', () => {
      const t = terms({
        applicability: ReferralApplicability.DATE_RANGE,
        validFrom: '2026-11-01',
        validTo: '2026-11-30',
      });
      expect(coversSession(t, 5, '2026-11-01')).toBe(true);
      expect(coversSession(t, 5, '2026-11-30')).toBe(true);
      expect(coversSession(t, 0, '2026-10-31')).toBe(false);
      expect(coversSession(t, 0, '2026-12-01')).toBe(false);
    });
  });

  describe('isOverride', () => {
    const defaults = { commission: percent('10.00'), discount: none };

    it('equal values are not an override (10 = 10.00)', () => {
      expect(
        isOverride({ commission: percent('10'), discount: none }, defaults),
      ).toBe(false);
    });

    it('a different value, type or an added discount is an override', () => {
      expect(
        isOverride({ commission: percent('12'), discount: none }, defaults),
      ).toBe(true);
      expect(
        isOverride({ commission: fixed('10'), discount: none }, defaults),
      ).toBe(true);
      expect(
        isOverride(
          { commission: percent('10'), discount: percent('5') },
          defaults,
        ),
      ).toBe(true);
    });
  });

  describe('currentAgreement', () => {
    const versions = [
      { version: 1, effectiveFrom: '2026-10-01' },
      { version: 2, effectiveFrom: '2026-11-03' },
      { version: 3, effectiveFrom: '2026-12-01' },
    ];

    it('is the highest version already in effect', () => {
      expect(currentAgreement(versions, '2026-11-02')?.version).toBe(1);
      expect(currentAgreement(versions, '2026-11-03')?.version).toBe(2);
      expect(currentAgreement(versions, '2026-12-01')?.version).toBe(3);
    });

    it('is null before the first version', () => {
      expect(currentAgreement(versions, '2026-09-30')).toBeNull();
    });
  });

  describe('normalizeRate / normalizeApplicability', () => {
    it('keeps a valid rate and canonicalizes the value', () => {
      expect(normalizeRate('commission', PERCENT, '10')).toEqual(
        percent('10.00'),
      );
      expect(normalizeRate('commission', NONE, null)).toEqual(none);
    });

    it('rejects NONE with a value, a missing value and a percentage above 100', () => {
      expect(() => normalizeRate('commission', NONE, '5')).toThrow(
        BadRequestException,
      );
      expect(() => normalizeRate('commission', FIXED, undefined)).toThrow(
        BadRequestException,
      );
      expect(() => normalizeRate('discount', PERCENT, '100.01')).toThrow(
        BadRequestException,
      );
    });

    it('keeps only the fields the applicability uses', () => {
      expect(
        normalizeApplicability({
          type: ReferralApplicability.SESSION_COUNT,
          maxSessions: 3,
        }),
      ).toEqual({
        applicability: ReferralApplicability.SESSION_COUNT,
        maxSessions: 3,
        validFrom: null,
        validTo: null,
      });
    });

    it('rejects a missing count, an inverted range and unused fields', () => {
      expect(() =>
        normalizeApplicability({ type: ReferralApplicability.SESSION_COUNT }),
      ).toThrow(BadRequestException);
      expect(() =>
        normalizeApplicability({
          type: ReferralApplicability.DATE_RANGE,
          validFrom: '2026-11-30',
          validTo: '2026-11-01',
        }),
      ).toThrow(BadRequestException);
      expect(() =>
        normalizeApplicability({
          type: ReferralApplicability.FIRST_SESSION,
          maxSessions: 2,
        }),
      ).toThrow(BadRequestException);
    });
  });
});

describe('allocatePayout', () => {
  const rows = (...remaining: string[]) =>
    remaining.map((value, i) => ({ id: `r${i + 1}`, remaining: value }));

  it('pays the oldest rows first, the last one in part', () => {
    // Earned 300, 200, 250, 150 (900); pay 350, then 200 more.
    expect(
      allocatePayout(rows('300.00', '200.00', '250.00', '150.00'), '350.00'),
    ).toEqual([
      { commissionId: 'r1', amount: '300.00' },
      { commissionId: 'r2', amount: '50.00' },
    ]);
    expect(
      allocatePayout(rows('150.00', '250.00', '150.00'), '200.00'),
    ).toEqual([
      { commissionId: 'r1', amount: '150.00' },
      { commissionId: 'r2', amount: '50.00' },
    ]);
  });

  it('settles everything when paying the whole outstanding amount', () => {
    expect(allocatePayout(rows('0.10', '0.20'), '0.30')).toEqual([
      { commissionId: 'r1', amount: '0.10' },
      { commissionId: 'r2', amount: '0.20' },
    ]);
  });

  it('deducts money owed back (negative rows) first, whatever their age', () => {
    // 100 owed, 30 taken back by a refund: 70 outstanding; pay 20.
    expect(allocatePayout(rows('100.00', '-30.00'), '20.00')).toEqual([
      { commissionId: 'r2', amount: '-30.00' },
      { commissionId: 'r1', amount: '50.00' },
    ]);
  });

  it('never pays more than is outstanding', () => {
    expect(() => allocatePayout(rows('100.00', '-30.00'), '70.01')).toThrow(
      'exceeds the outstanding commission',
    );
  });
});
