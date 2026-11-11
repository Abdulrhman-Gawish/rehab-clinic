// CHECK for a "<prefix>_type" / "<prefix>_value" pair: NONE has no value,
// PERCENT is 0 < value <= 100, FIXED is value > 0.
export const rateCheck = (prefix: string) =>
  `("${prefix}_type" = 'NONE' AND "${prefix}_value" IS NULL)
   OR ("${prefix}_type" = 'PERCENT' AND "${prefix}_value" > 0 AND "${prefix}_value" <= 100)
   OR ("${prefix}_type" = 'FIXED' AND "${prefix}_value" > 0)`;

// Reason written on an invoice discount that comes from referral terms.
export const referralDiscountReason = (doctorName: string) =>
  `Doctor referral: ${doctorName}`.slice(0, 255);
