// The clinic's public contact details and website figures (verified legacy values, FRONTEND_IMPLEMENTATION_GUIDE.md
// section 12.1). Kept here, not in markup, so they change in one place. Text that is translated (address, service
// names, the founder's title) lives in src/i18n/areas/site.*.ts.
export const SITE = {
  domain: 'https://rehabeg.clinic',
  email: 'support@rehabeg.clinic',
  /** E.164, shown as "+20 1204515349". */
  phones: ['+201204515349', '+201507110041', '+201066205166', '+201125902099'],
  whatsapp: 'https://www.wa.link/mtmbq6',
  social: {
    facebook: 'https://www.facebook.com/rehabclinic11',
    instagram: 'https://www.instagram.com/rehabclinic11',
    tiktok: 'https://www.tiktok.com/@rehabclinic11',
  },
  /** The statistics strip on the home page. */
  stats: { beds: 7, sessions: 160000, clients: 20000, doctors: 10, years: 21 },
} as const;

/** "+201204515349" -> "+20 1204515349" (display only; links use the E.164 value). */
export const displayPhone = (e164: string) => e164.replace(/^\+20/, '+20 ');
