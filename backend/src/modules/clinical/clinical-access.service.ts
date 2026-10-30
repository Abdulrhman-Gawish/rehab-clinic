import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-request.interface.js';
import { Appointment } from '../appointments/entities/appointment.entity.js';
import { DoctorAccessService } from '../doctors/doctor-access.service.js';
import { Patient } from '../patients/entities/patient.entity.js';
import { Visit } from '../visits/entities/visit.entity.js';

/**
 * Who may see a patient's clinical data (clinical routes allow only OWNER
 * and DOCTOR; the patient overview and timeline also call it for a
 * RECEPTIONIST, which is then only an existence check).
 * - OWNER: every patient (read-only by route).
 * - DOCTOR: only patients they have at least one appointment or visit with,
 *   in any status. Otherwise 404, so the patient's existence isn't revealed.
 */
@Injectable()
export class ClinicalAccessService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly doctors: DoctorAccessService,
  ) {}

  // Returns the caller's doctor id (null for OWNER).
  async assertCanAccessPatient(
    user: AuthenticatedUser,
    patientId: string,
  ): Promise<string | null> {
    const doctorId = await this.doctors.scopeFor(user);
    const exists = await this.dataSource
      .getRepository(Patient)
      .existsBy({ id: patientId });
    if (!exists || (doctorId && !(await this.treats(doctorId, patientId)))) {
      throw new NotFoundException('Patient not found');
    }
    return doctorId;
  }

  private async treats(doctorId: string, patientId: string): Promise<boolean> {
    return (
      (await this.dataSource
        .getRepository(Visit)
        .existsBy({ doctorId, patientId })) ||
      this.dataSource
        .getRepository(Appointment)
        .existsBy({ doctorId, patientId })
    );
  }
}
