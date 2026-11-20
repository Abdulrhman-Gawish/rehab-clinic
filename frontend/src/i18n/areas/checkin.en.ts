// Patient details collected at check-in (identity document, gender, birth date, notes, referral source) and the
// patient code. English text; the Arabic file has exactly the same shape.
export const checkinEn = {
  checkIn: {
    title: 'Patient details',
    hint: 'Needed before the patient enters the doctor.',
    complete: 'Patient details complete',
    code: 'Patient code',
    noCode: 'Assigned with the identity document',
    idType: 'Identity document',
    idTypes: { NATIONAL_ID: 'National ID', PASSPORT: 'Passport (non-Egyptian)' } as Record<string, string>,
    nationalId: 'National ID',
    nationalIdHint: '14 digits. The date of birth and gender are filled in from it.',
    passport: 'Passport number',
    passportHint: 'Letters and digits.',
    gender: 'Gender',
    dob: 'Date of birth',
    age: 'Age',
    fromNationalId: 'From the National ID.',
    ageHint: (age: string) => `Age: ${age}`,
    // Full years, or months under a year.
    ageText: (years: number, months: number) => {
      if (years >= 1) return `${years} ${years === 1 ? 'year' : 'years'}`;
      if (months >= 1) return `${months} ${months === 1 ? 'month' : 'months'}`;
      return 'Under a month';
    },
    notes: 'Administrative notes',
    notesHint: 'Never medical information.',
    source: 'Referral source',
    sourceHint: 'How the patient found the clinic. A doctor referral is recorded with its doctor and terms.',
    pickSource: 'Choose…',
    sourceDetails: 'Details',
    sourceDetailsPh: 'Which ad, which friend…',
    locked: 'Only the owner can change the identity document of a patient who has a code.',
    problems: {
      required: 'Required.',
      nationalIdFormat: 'A National ID has 14 digits.',
      nationalIdInvalid: 'Not a valid National ID (century or birth date).',
      passportFormat: '5 to 20 letters and digits.',
      dobMismatch: 'Does not match the National ID.',
      genderMismatch: 'Does not match the National ID.',
      future: 'Cannot be in the future.',
    } as Record<string, string>,
    edit: 'Edit details',
    searchPh: 'Name, phone, patient code or ID number',
    saved: 'Patient details saved',
  },
};
