import type { DataSource } from 'typeorm';
import { UserRole } from '../../common/enums/user-role.enum.js';
import type { FileStorage } from '../../common/storage/file-storage.service.js';
import type { ClinicTimeService } from '../../common/time/clinic-time.service.js';
import type { AuditService } from '../audit/audit.service.js';
import type { ClinicalAccessService } from './clinical-access.service.js';
import { PatientAttachmentsService } from './patient-attachments.service.js';

// The cleanup order of an upload whose transaction fails (the real rollback
// is covered by clinical.e2e-spec.ts).
describe('PatientAttachmentsService.upload when the transaction fails', () => {
  const PNG = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from('x-ray'),
  ]);
  const upload = {
    buffer: PNG,
    size: PNG.length,
    originalname: 'xray.png',
    mimetype: 'image/png',
  };
  const user = { id: 'u1', role: UserRole.OWNER };
  const actor = { userId: 'u1', role: UserRole.OWNER, ip: null };

  it('removes the file it stored and rethrows the database error', async () => {
    const dbError = new Error('database is down');
    const storage = {
      put: vi.fn().mockResolvedValue(undefined),
      discard: vi.fn().mockResolvedValue(undefined),
    };
    const service = new PatientAttachmentsService(
      {
        transaction: vi.fn().mockRejectedValue(dbError),
      } as unknown as DataSource,
      {
        assertCanAccessPatient: vi.fn().mockResolvedValue(null),
      } as unknown as ClinicalAccessService,
      storage as unknown as FileStorage,
      {} as AuditService,
      {} as ClinicTimeService,
    );

    await expect(
      service.upload('p1', { title: 'X-ray' }, upload, user, actor),
    ).rejects.toBe(dbError);
    const key = storage.put.mock.calls[0][0] as string;
    expect(key).toMatch(/^patients\/p1\/[0-9a-f-]{36}\.png$/);
    expect(storage.discard).toHaveBeenCalledWith(key);
  });
});
