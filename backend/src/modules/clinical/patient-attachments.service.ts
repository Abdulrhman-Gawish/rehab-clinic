import { randomUUID } from 'node:crypto';
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ErrorCode, unprocessable } from '../../common/errors/app.exception.js';
import type {
  Actor,
  AuthenticatedUser,
} from '../../common/interfaces/authenticated-request.interface.js';
import {
  FileStorage,
  type StoredFile,
} from '../../common/storage/file-storage.service.js';
import {
  checkUpload,
  type UploadedFileData,
} from '../../common/storage/file-type.util.js';
import { ClinicTimeService } from '../../common/time/clinic-time.service.js';
import { AuditAction, AuditEntityType } from '../audit/audit.constants.js';
import { AuditService } from '../audit/audit.service.js';
import { Visit } from '../visits/entities/visit.entity.js';
import { ClinicalAccessService } from './clinical-access.service.js';
import { toAttachment } from './clinical.mapper.js';
import type {
  AttachmentResponseDto,
  AttachmentUploadDto,
} from './dto/clinical.dto.js';
import { PatientAttachment } from './entities/patient-attachment.entity.js';

export interface AttachmentFile extends StoredFile {
  mimeType: string;
  fileName: string;
}

// X-rays, reports, lab results. Same file rules as expense receipts; files
// are never public, only streamed to OWNER and doctors with access.
@Injectable()
export class PatientAttachmentsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly access: ClinicalAccessService,
    private readonly storage: FileStorage,
    private readonly auditService: AuditService,
    private readonly time: ClinicTimeService,
  ) {}

  async upload(
    patientId: string,
    dto: AttachmentUploadDto,
    upload: UploadedFileData | undefined,
    user: AuthenticatedUser,
    actor: Actor,
  ): Promise<AttachmentResponseDto> {
    await this.access.assertCanAccessPatient(user, patientId);
    // Size: the upload interceptor already answered 413 above MAX_UPLOAD_BYTES.
    const { file, type } = checkUpload(upload);
    if (dto.visitId) await this.assertVisitOfPatient(dto.visitId, patientId);

    const fileKey = `patients/${patientId}/${randomUUID()}.${type.extension}`;
    await this.storage.put(fileKey, file.buffer);
    const attachment = await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(PatientAttachment);
      const saved = await repository.save(
        repository.create({
          patientId,
          visitId: dto.visitId ?? null,
          title: dto.title,
          fileKey,
          mimeType: type.mimeType,
          sizeBytes: file.size,
          uploadedById: actor.userId as string,
        }),
      );
      await this.auditService.logAction(
        actor,
        AuditAction.PATIENT_ATTACHMENT_UPLOADED,
        AuditEntityType.PATIENT_ATTACHMENT,
        saved.id,
        {
          newValues: {
            patientId,
            visitId: saved.visitId,
            title: saved.title,
            mimeType: saved.mimeType,
            sizeBytes: saved.sizeBytes,
          },
        },
        manager,
      );
      return saved;
    });
    const withUser = await this.dataSource
      .getRepository(PatientAttachment)
      .findOneOrFail({
        where: { id: attachment.id },
        relations: { uploadedBy: true },
      });
    return toAttachment(withUser, (d) => this.time.toIso(d));
  }

  async list(
    patientId: string,
    user: AuthenticatedUser,
  ): Promise<AttachmentResponseDto[]> {
    await this.access.assertCanAccessPatient(user, patientId);
    const rows = await this.dataSource.getRepository(PatientAttachment).find({
      where: { patientId },
      relations: { uploadedBy: true },
      order: { createdAt: 'DESC' },
    });
    return rows.map((row) => toAttachment(row, (d) => this.time.toIso(d)));
  }

  async file(id: string, user: AuthenticatedUser): Promise<AttachmentFile> {
    const attachment = await this.dataSource
      .getRepository(PatientAttachment)
      .findOneBy({ id });
    if (!attachment) throw new NotFoundException('Attachment not found');
    await this.access.assertCanAccessPatient(user, attachment.patientId);
    const extension = attachment.fileKey.slice(
      attachment.fileKey.lastIndexOf('.') + 1,
    );
    return {
      ...(await this.storage.get(attachment.fileKey)),
      mimeType: attachment.mimeType,
      fileName: `${attachment.id}.${extension}`,
    };
  }

  private async assertVisitOfPatient(
    visitId: string,
    patientId: string,
  ): Promise<void> {
    const visit = await this.dataSource
      .getRepository(Visit)
      .findOneBy({ id: visitId });
    if (visit?.patientId !== patientId) {
      throw unprocessable(
        ErrorCode.ATTACHMENT_VISIT_MISMATCH,
        'The visit does not belong to this patient',
      );
    }
  }
}
