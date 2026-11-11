import { isBirthDate } from './birth-date.decorator.js';

describe('isBirthDate', () => {
  it.each(['1990-05-17', '2000-02-29', '1900-01-01'])('accepts %s', (value) => {
    expect(isBirthDate(value)).toBe(true);
  });

  it.each([
    ['impossible date', '2023-02-29'],
    ['bad month', '1990-13-01'],
    ['future', '2999-01-01'],
    ['before 1900', '1899-12-31'],
    ['datetime', '1990-05-17T00:00:00Z'],
    ['other format', '17/05/1990'],
    ['not a string', 19900517],
  ])('rejects %s', (_label, value) => {
    expect(isBirthDate(value)).toBe(false);
  });
});
