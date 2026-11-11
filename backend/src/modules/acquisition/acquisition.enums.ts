// How a patient says they found the clinic, recorded by reception. This is
// separate from the UTM data of online bookings (appointments.utm_*): one
// never fills in or overwrites the other.
export enum AcquisitionChannel {
  FACEBOOK = 'FACEBOOK',
  INSTAGRAM = 'INSTAGRAM',
  OTHER_SOCIAL_MEDIA = 'OTHER_SOCIAL_MEDIA',
  GOOGLE = 'GOOGLE',
  GOOGLE_ADS = 'GOOGLE_ADS',
  ADVERTISEMENT = 'ADVERTISEMENT',
  FRIENDS_FAMILY = 'FRIENDS_FAMILY',
  EXISTING_PATIENT = 'EXISTING_PATIENT',
  WEBSITE = 'WEBSITE',
  DOCTOR_REFERRAL = 'DOCTOR_REFERRAL',
  OTHER = 'OTHER',
}

// The channel's group in reports. Derived from the channel, never stored.
export enum AcquisitionCategory {
  SOCIAL_MEDIA = 'SOCIAL_MEDIA',
  SEARCH = 'SEARCH',
  ADVERTISING = 'ADVERTISING',
  WORD_OF_MOUTH = 'WORD_OF_MOUTH',
  WEBSITE = 'WEBSITE',
  REFERRAL = 'REFERRAL',
  OTHER = 'OTHER',
}

export const CHANNEL_CATEGORY: Record<AcquisitionChannel, AcquisitionCategory> =
  {
    [AcquisitionChannel.FACEBOOK]: AcquisitionCategory.SOCIAL_MEDIA,
    [AcquisitionChannel.INSTAGRAM]: AcquisitionCategory.SOCIAL_MEDIA,
    [AcquisitionChannel.OTHER_SOCIAL_MEDIA]: AcquisitionCategory.SOCIAL_MEDIA,
    [AcquisitionChannel.GOOGLE]: AcquisitionCategory.SEARCH,
    [AcquisitionChannel.GOOGLE_ADS]: AcquisitionCategory.ADVERTISING,
    [AcquisitionChannel.ADVERTISEMENT]: AcquisitionCategory.ADVERTISING,
    [AcquisitionChannel.FRIENDS_FAMILY]: AcquisitionCategory.WORD_OF_MOUTH,
    [AcquisitionChannel.EXISTING_PATIENT]: AcquisitionCategory.WORD_OF_MOUTH,
    [AcquisitionChannel.WEBSITE]: AcquisitionCategory.WEBSITE,
    [AcquisitionChannel.DOCTOR_REFERRAL]: AcquisitionCategory.REFERRAL,
    [AcquisitionChannel.OTHER]: AcquisitionCategory.OTHER,
  };
