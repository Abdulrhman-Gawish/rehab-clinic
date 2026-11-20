import type { Test } from 'supertest';
import type { DataSource } from 'typeorm';

/**
 * Test setup for suites that are not about check-in: every patient missing
 * something check-in requires gets a test passport (from its id), a gender,
 * a birth date and an OTHER referral source. Never overwrites a value, and
 * assigns no patient code (that is the API's job, tested in patients-checkin).
 */
export async function completeCheckInDetails(
  dataSource: DataSource,
): Promise<void> {
  await dataSource.query(
    `UPDATE patients
        SET passport_number = 'T' || upper(substr(replace(id::text, '-', ''), 1, 12))
      WHERE national_id IS NULL AND passport_number IS NULL`,
  );
  await dataSource.query(
    `UPDATE patients SET gender = 'MALE' WHERE gender IS NULL`,
  );
  await dataSource.query(
    `UPDATE patients SET date_of_birth = '1990-01-01' WHERE date_of_birth IS NULL`,
  );
  await dataSource.query(
    `INSERT INTO patient_acquisition_sources (patient_id, channel, is_primary, recorded_by, recorded_at)
     SELECT p.id, 'OTHER', true, (SELECT id FROM users ORDER BY created_at, id LIMIT 1), now()
       FROM patients p
      WHERE NOT EXISTS (SELECT 1 FROM patient_acquisition_sources s
                         WHERE s.patient_id = p.id AND s.removed_at IS NULL)`,
  );
}

/**
 * Check-in details for a walk-in that creates its patient (name + phone):
 * the same passport for the same phone, so a returning patient sends an
 * unchanged document.
 */
export function checkInDetailsFor(phone: string) {
  return {
    passportNumber: `T${phone.replace(/\D/g, '').slice(-12)}`,
    gender: 'MALE',
    dateOfBirth: '1990-01-01',
    referralSource: { channel: 'OTHER' },
  };
}

/**
 * `test` (a supertest request) sent only after completeCheckInDetails, so a
 * helper can keep returning the request for `.expect()` chaining (awaiting
 * a supertest request calls its `end`).
 */
export function afterCheckInSetup(test: Test, dataSource: DataSource): Test {
  const end = test.end.bind(test);
  test.end = (callback?: Parameters<Test['end']>[0]) => {
    completeCheckInDetails(dataSource).then(
      () => end(callback),
      (error: unknown) => callback?.(error as Error, undefined as never),
    );
    return test;
  };
  return test;
}
