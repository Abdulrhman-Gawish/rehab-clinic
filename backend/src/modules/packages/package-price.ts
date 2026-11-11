import {
  percentOf,
  subMoney,
  toMoney,
  ZERO,
} from '../../common/utils/money.util.js';
import { DiscountType } from '../billing/billing.enums.js';

// Pure offer arithmetic for packages.

export interface PackageOffer {
  type: DiscountType;
  // PERCENT: 20 = 20%. FIXED: EGP.
  value: string;
  // Clinic local dates (inclusive); null = open-ended.
  startsOn: string | null;
  endsOn: string | null;
}

// The offer applies on `today` (a clinic local date, YYYY-MM-DD).
export function isOfferActive(
  offer: PackageOffer | null,
  today: string,
): boolean {
  if (!offer) return false;
  return (
    (offer.startsOn === null || offer.startsOn <= today) &&
    (offer.endsOn === null || today <= offer.endsOn)
  );
}

// EGP taken off `price` by the offer on `today` (0.00 when not active).
export function offerAmount(
  price: string,
  offer: PackageOffer | null,
  today: string,
): string {
  if (!offer || !isOfferActive(offer, today)) return ZERO;
  return offer.type === DiscountType.PERCENT
    ? percentOf(price, offer.value)
    : toMoney(offer.value);
}

export function sellingPrice(
  price: string,
  offer: PackageOffer | null,
  today: string,
): string {
  return subMoney(price, offerAmount(price, offer, today));
}
