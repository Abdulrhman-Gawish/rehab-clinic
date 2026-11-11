import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FileStorage } from '../../common/storage/file-storage.service.js';
import { DoctorsModule } from '../doctors/doctors.module.js';
import { ClinicalAccessService } from './clinical-access.service.js';
import { ClinicalNotesService } from './clinical-notes.service.js';
import {
  AttachmentsController,
  ClinicalNotesController,
  PatientClinicalController,
  VisitNoteController,
} from './clinical.controller.js';
import { ClinicalNoteAddendum } from './entities/clinical-note-addendum.entity.js';
import { ClinicalNote } from './entities/clinical-note.entity.js';
import { PatientAttachment } from './entities/patient-attachment.entity.js';
import { PatientMedicalInfo } from './entities/patient-medical-info.entity.js';
import { MedicalInfoService } from './medical-info.service.js';
import { PatientAttachmentsService } from './patient-attachments.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PatientMedicalInfo,
      ClinicalNote,
      ClinicalNoteAddendum,
      PatientAttachment,
    ]),
    DoctorsModule,
  ],
  controllers: [
    PatientClinicalController,
    VisitNoteController,
    ClinicalNotesController,
    AttachmentsController,
  ],
  providers: [
    ClinicalAccessService,
    MedicalInfoService,
    ClinicalNotesService,
    PatientAttachmentsService,
    FileStorage,
  ],
  exports: [ClinicalAccessService],
})
export class ClinicalModule {}
