import {
  addMoney,
  compareMoney,
  lineTotal,
  percentageOfBase,
  percentOf,
  subMoney,
  toMoney,
} from './money.util.js';

describe('money utils', () => {
  it('formats with 2 decimals, rounding half up', () => {
    expect(toMoney('320')).toBe('320.00');
    expect(toMoney('0.005')).toBe('0.01');
    expect(toMoney('0.004')).toBe('0.00');
    expect(toMoney('2.675')).toBe('2.68'); // binary floats would give 2.67
  });

  it('adds without float errors', () => {
    expect(addMoney('0.10', '0.20')).toBe('0.30');
    expect(addMoney('99999999.99', '0.01')).toBe('100000000.00');
    expect(subMoney('100.00', '33.33')).toBe('66.67');
  });

  it('line totals', () => {
    expect(lineTotal('33.33', 3)).toBe('99.99');
    expect(lineTotal('0.10', 3)).toBe('0.30');
  });

  it.each([
    ['100.00', '33.33', '33.33'],
    ['99.99', '12.5', '12.50'], // 12.49875 -> 12.50
    ['99.99', '33.33', '33.33'], // 33.326667 -> 33.33
    ['10.00', '33.33', '3.33'], // 3.333 -> 3.33
    ['0.05', '50', '0.03'], // 0.025 -> 0.03 (half up)
    ['200.00', '100', '200.00'],
    ['150.00', '0.01', '0.02'], // 0.015 -> 0.02
  ])('%s x %s%% = %s', (amount, percent, expected) => {
    expect(percentOf(amount, percent)).toBe(expected);
  });

  it('effective percentage and comparisons', () => {
    expect(percentageOfBase('25.00', '100.00').toString()).toBe('25');
    expect(percentageOfBase('5.00', '0.00').toString()).toBe('0');
    expect(compareMoney('10.00', '9.99')).toBe(1);
    expect(compareMoney('10', '10.00')).toBe(0);
  });
});
