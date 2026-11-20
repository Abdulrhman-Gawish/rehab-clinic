import { SalaryCommissionMode, SalaryRateType } from './salaries.enums.js';
import {
  commissionOf,
  monthDates,
  packageSessionValue,
  rateFor,
  termsForMonth,
  type TermsLike,
} from './salary-math.js';

const { FIXED, PERCENT } = SalaryRateType;

const terms = (over: Partial<TermsLike>): TermsLike => ({
  effectiveMonth: '2026-01',
  commissionMode: SalaryCommissionMode.NONE,
  sessionRateType: null,
  sessionRateValue: null,
  serviceRates: [],
  ...over,
});

describe('salary math', () => {
  it('monthDates: first and last day, December and leap February included', () => {
    expect(monthDates('2026-11')).toEqual({
      first: '2026-11-01',
      last: '2026-11-30',
    });
    expect(monthDates('2026-12')).toEqual({
      first: '2026-12-01',
      last: '2026-12-31',
    });
    expect(monthDates('2028-02')).toEqual({
      first: '2028-02-01',
      last: '2028-02-29',
    });
  });

  it('termsForMonth: the latest version starting on or before the month', () => {
    const v = [
      { effectiveMonth: '2026-03' },
      { effectiveMonth: '2026-01' },
      { effectiveMonth: '2026-07' },
    ];
    expect(termsForMonth(v, '2025-12')).toBeNull();
    expect(termsForMonth(v, '2026-01')?.effectiveMonth).toBe('2026-01');
    expect(termsForMonth(v, '2026-06')?.effectiveMonth).toBe('2026-03');
    expect(termsForMonth(v, '2027-01')?.effectiveMonth).toBe('2026-07');
  });

  it('rateFor: none, per session (any service), per service (only listed ones)', () => {
    expect(rateFor(null, 's1')).toBeNull();
    expect(rateFor(terms({}), 's1')).toBeNull();
    const perSession = terms({
      commissionMode: SalaryCommissionMode.PER_SESSION,
      sessionRateType: FIXED,
      sessionRateValue: '50',
    });
    expect(rateFor(perSession, 'any')).toEqual({ type: FIXED, value: '50.00' });
    const perService = terms({
      commissionMode: SalaryCommissionMode.PER_SERVICE,
      serviceRates: [{ serviceId: 's1', rateType: PERCENT, value: '20' }],
    });
    expect(rateFor(perService, 's1')).toEqual({
      type: PERCENT,
      value: '20.00',
    });
    expect(rateFor(perService, 's2')).toBeNull();
  });

  it('commissionOf: fixed amount, percentage of the session value, none', () => {
    expect(commissionOf({ type: FIXED, value: '50.00' }, '300.00')).toBe(
      '50.00',
    );
    expect(commissionOf({ type: FIXED, value: '50.00' }, '0.00')).toBe('50.00');
    expect(commissionOf({ type: PERCENT, value: '20.00' }, '300.00')).toBe(
      '60.00',
    );
    expect(commissionOf({ type: PERCENT, value: '12.50' }, '99.99')).toBe(
      '12.50',
    );
    expect(commissionOf(null, '300.00')).toBe('0.00');
  });

  it('packageSessionValue: price / sessions, rounded to 2 decimals', () => {
    expect(packageSessionValue('3000.00', 10)).toBe('300.00');
    expect(packageSessionValue('1000.00', 3)).toBe('333.33');
    expect(packageSessionValue('1000.00', 0)).toBe('0.00');
  });
});
