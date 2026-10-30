import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, In, MoreThanOrEqual } from 'typeorm';
import { UserRole } from '../../common/enums/user-role.enum.js';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-request.interface.js';
import { ClinicTimeService } from '../../common/time/clinic-time.service.js';
import { AppointmentStatus } from '../appointments/appointment.enums.js';
import { Appointment } from '../appointments/entities/appointment.entity.js';
import { InvoicesService } from '../billing/invoices.service.js';
import { ClinicalAccessService } from '../clinical/clinical-access.service.js';
import { NoteStatus } from '../clinical/clinical.enums.js';
import type { Doctor } from '../doctors/entities/doctor.entity.js';
import { Patient } from '../patients/entities/patient.entity.js';
import { Visit } from '../visits/entities/visit.entity.js';
import { VisitStatus } from '../visits/visit.enums.js';
import type {
  NamedRefDto,
  OverviewDoctorDto,
  OverviewNoteDto,
  PatientOverviewDto,
} from './dto/patient-history.dto.js';

// Requires `user` to be loaded.
function doctorRef(doctor: Doctor | undefined): NamedRefDto {
  if (!doctor?.user) throw new Error('Doctor user is not loaded');
  return { id: doctor.id, name: doctor.user.name };
}

@Injectable()
export class PatientHistoryService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly access: ClinicalAccessService,
    private readonly invoices: InvoicesService,
    private readonly time: ClinicTimeService,
  ) {}

  /**
   * The patient page in one request. A DOCTOR needs access to the patient
   * (404 otherwise) and gets no balance; a RECEPTIONIST gets no clinical
   * data (notesNeedingAttention is null).
   */
  async overview(
    patientId: string,
    user: AuthenticatedUser,
  ): Promise<PatientOverviewDto> {
    const doctorId = await this.access.assertCanAccessPatient(user, patientId);
    const toIso = (d: Date) => this.time.toIso(d);
    const patient = await this.dataSource
      .getRepository(Patient)
      .findOneByOrFail({ id: patientId });

    const next = await this.dataSource.getRepository(Appointment).findOne({
      where: {
        patientId,
        status: In([AppointmentStatus.PENDING, AppointmentStatus.CONFIRMED]),
        startAt: MoreThanOrEqual(this.time.now()),
      },
      relations: { doctor: { user: true }, service: true },
      order: { startAt: 'ASC', id: 'ASC' },
    });
    const last = await this.dataSource.getRepository(Visit).findOne({
      where: { patientId, status: VisitStatus.ACTIVE },
      relations: { doctor: { user: true }, service: true },
      order: { attendedAt: 'DESC', id: 'DESC' },
    });

    return {
      patient: {
        id: patient.id,
        name: patient.name,
        phone: patient.phone,
        createdSource: patient.createdSource,
        createdAt: toIso(patient.createdAt),
      },
      nextAppointment: next && {
        id: next.id,
        startAt: toIso(next.startAt),
        status: next.status,
        doctor: doctorRef(next.doctor),
        service: { id: next.serviceId, name: next.service!.name },
      },
      lastVisit: last && {
        id: last.id,
        attendedAt: toIso(last.attendedAt),
        isWalkIn: last.appointmentId === null,
        doctor: doctorRef(last.doctor),
        service: { id: last.serviceId, name: last.service!.name },
      },
      counts: await this.counts(patientId),
      doctors: await this.doctorsSeen(patientId),
      balance:
        user.role === UserRole.DOCTOR
          ? null
          : await this.invoices.balance(patientId),
      notesNeedingAttention:
        user.role === UserRole.RECEPTIONIST
          ? null
          : await this.notesNeedingAttention(patientId, doctorId),
    };
  }

  private async counts(
    patientId: string,
  ): Promise<PatientOverviewDto['counts']> {
    const [row]: { attended: string; no_show: string; cancelled: string }[] =
      await this.dataSource.query(
        `SELECT
           (SELECT COUNT(*) FROM visits WHERE patient_id = $1 AND status = 'ACTIVE') AS attended,
           (SELECT COUNT(*) FROM appointments WHERE patient_id = $1 AND status = 'NO_SHOW') AS no_show,
           (SELECT COUNT(*) FROM appointments WHERE patient_id = $1 AND status = 'CANCELLED') AS cancelled`,
        [patientId],
      );
    return {
      attended: Number(row.attended),
      noShow: Number(row.no_show),
      cancelled: Number(row.cancelled),
    };
  }

  // Doctors with at least one ACTIVE visit, most recent visit first.
  private async doctorsSeen(patientId: string): Promise<OverviewDoctorDto[]> {
    const rows: { id: string; name: string; last_visit_at: Date }[] =
      await this.dataSource.query(
        `SELECT d.id, u.name, MAX(v.attended_at) AS last_visit_at
           FROM visits v
           JOIN doctors d ON d.id = v.doctor_id
           JOIN users u ON u.id = d.user_id
          WHERE v.patient_id = $1 AND v.status = 'ACTIVE'
          GROUP BY d.id, u.name
          ORDER BY last_visit_at DESC, d.id`,
        [patientId],
      );
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      lastVisitAt: this.time.toIso(row.last_visit_at),
    }));
  }

  // ACTIVE visits without a SIGNED note, oldest first (one doctor's when
  // doctorId is set).
  private async notesNeedingAttention(
    patientId: string,
    doctorId: string | null,
  ): Promise<OverviewNoteDto[]> {
    const rows: {
      visit_id: string;
      attended_at: Date;
      doctor_id: string;
      doctor_name: string;
      service_id: string;
      service_name: string;
      note_status: NoteStatus | null;
    }[] = await this.dataSource.query(
      `SELECT v.id AS visit_id, v.attended_at, d.id AS doctor_id, u.name AS doctor_name,
              s.id AS service_id, s.name AS service_name, n.status AS note_status
         FROM visits v
         JOIN doctors d ON d.id = v.doctor_id
         JOIN users u ON u.id = d.user_id
         JOIN clinic_services s ON s.id = v.service_id
         LEFT JOIN clinical_notes n ON n.visit_id = v.id
        WHERE v.patient_id = $1 AND v.status = 'ACTIVE'
          AND (n.id IS NULL OR n.status = 'DRAFT')
          AND ($2::uuid IS NULL OR v.doctor_id = $2)
        ORDER BY v.attended_at, v.id`,
      [patientId, doctorId],
    );
    return rows.map((row) => ({
      visitId: row.visit_id,
      attendedAt: this.time.toIso(row.attended_at),
      doctor: { id: row.doctor_id, name: row.doctor_name },
      service: { id: row.service_id, name: row.service_name },
      noteStatus: row.note_status,
    }));
  }
}
