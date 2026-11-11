import { Decimal } from 'decimal.js';

/**
 * Money helpers. Amounts travel as strings with 2 decimals ("320.00") and
 * all arithmetic goes through decimal.js: never JS number math for money.
 * Rounding is ROUND_HALF_UP to 2 decimals.
 */
const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export type MoneyInput = string | Decimal;

export const ZERO = '0.00';

export function dec(value: MoneyInput): Decimal {
  return new D(value);
}

// Canonical 2-decimal string, rounded half up.
export function toMoney(value: MoneyInput): string {
  return dec(value).toDecimalPlaces(2, D.ROUND_HALF_UP).toFixed(2);
}

export function addMoney(...values: MoneyInput[]): string {
  return toMoney(
    values.reduce<Decimal>((sum, v) => sum.plus(dec(v)), new D(0)),
  );
}

export function subMoney(a: MoneyInput, b: MoneyInput): string {
  return toMoney(dec(a).minus(dec(b)));
}

// unitPrice x quantity.
export function lineTotal(unitPrice: MoneyInput, quantity: number): string {
  return toMoney(dec(unitPrice).times(quantity));
}

// round_half_up(amount * percent / 100, 2)
export function percentOf(amount: MoneyInput, percent: MoneyInput): string {
  return toMoney(dec(amount).times(dec(percent)).dividedBy(100));
}

// amount / base * 100 (unrounded), 0 when base is 0.
export function percentageOfBase(
  amount: MoneyInput,
  base: MoneyInput,
): Decimal {
  const b = dec(base);
  return b.isZero() ? new D(0) : dec(amount).times(100).dividedBy(b);
}

export function compareMoney(a: MoneyInput, b: MoneyInput): -1 | 0 | 1 {
  return dec(a).comparedTo(dec(b)) as -1 | 0 | 1;
}

export const isZeroMoney = (value: MoneyInput) => dec(value).isZero();
export const isPositiveMoney = (value: MoneyInput) => dec(value).greaterThan(0);
