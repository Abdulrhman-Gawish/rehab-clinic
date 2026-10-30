import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  EntityManager,
  In,
  IsNull,
  Repository,
  type SelectQueryBuilder,
} from 'typeorm';
import { UserRole } from '../../common/enums/user-role.enum.js';
import { ErrorCode, unprocessable } from '../../common/errors/app.exception.js';
import type {
  Actor,
  AuthenticatedUser,
} from '../../common/interfaces/authenticated-request.interface.js';
import { ClinicTimeService } from '../../common/time/clinic-time.service.js';
import { subMoney } from '../../common/utils/money.util.js';
import type { Appointment } from '../appointments/entities/appointment.entity.js';
import { AuditAction, AuditEntityType } from '../audit/audit.constants.js';
import { AuditService } from '../audit/audit.service.js';
import { InvoicesService } from '../billing/invoices.service.js';
import { ClinicalAccessService } from '../clinical/clinical-access.service.js';
import { Patient } from '../patients/entities/patient.entity.js';
import type { Visit } from '../visits/entities/visit.entity.js';
import type {
  PackageChoiceDto,
  PackageSessionDto,
  PatientPackageDetailDto,
  PatientPackageDto,
  SellPackageDto,
} from './dto/package.dto.js';
import { PackageDoctor } from './entities/package-doctor.entity.js';
import { PackageUsage } from './entities/package-usage.entity.js';
import { Package } from './entities/package.entity.js';
import { PatientPackage } from './entities/patient-package.entity.js';
import { offerAmount } from './package-price.js';
import {
  offerOf,
  toPackageSession,
  toPackageUsage,
  toPatientPackage,
} from './package.mapper.js';
import { PackageUsageReason, PatientPackageStatus } from './packages.enums.js';

// What a session is used for: the patient, service and doctor of the visit
// or of the no-show appointment.
type SessionTarget = Pick<Visit, 'patientId' | 'serviceId' | 'doctorId'>;

// patientPackageId and usePackage: false contradict each other. Call before
// any other work.
export function assertPackageChoice(choice: PackageChoiceDto): void {
  if (choice.patientPackageId && choice.usePackage === false) {
    throw new BadRequestException(
      'Provide either patientPackageId or usePackage: false, not both',
    );
  }
}

// The package's current doctor list allows :doctorId (alias pp).
const DOCTOR_ALLOWED = `EXISTS (SELECT 1 FROM packages p WHERE p.id = pp.package_id
  AND (p.all_doctors OR EXISTS (SELECT 1 FROM package_doctors pd
    WHERE pd.package_id = p.id AND pd.doctor_id = :doctorId)))`;

/**
 * Sold packages and their sessions. Using or restoring a session locks the
 * patient_packages row (FOR UPDATE); the CHECKs on that row make a session
 * count above the total, or a wrong status, impossible.
 */
@Injectable()
export class PatientPackagesService {
  constructor(
    @InjectRepository(PatientPackage)
    private readonly patientPackages: Repository<PatientPackage>,
    @InjectRepository(PackageUsage)
    private readonly usages: Repository<PackageUsage>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly invoices: InvoicesService,
    private readonly access: ClinicalAccessService,
    private readonly auditService: AuditService,
    private readonly time: ClinicTimeService,
  ) {}

  // ---------- Desk commands ----------

  // The patient package and its invoice (selling price, no visit), together.
  async sell(
    patientId: string,
    dto: SellPackageDto,
    actor: Actor,
  ): Promise<PatientPackageDetailDto> {
    const id = await this.dataSource.transaction(async (manager) => {
      if (!(await manager.existsBy(Patient, { id: patientId }))) {
        throw new NotFoundException('Patient not found');
      }
      const pkg = await manager.findOne(Package, {
        where: { id: dto.packageId },
        relations: { service: true },
      });
      if (!pkg) throw new NotFoundException('Package not found');
      if (!pkg.isActive || !pkg.service?.isActive) {
        throw unprocessable(
          ErrorCode.PACKAGE_INACTIVE,
          'This package is no longer sold',
        );
      }

      const soldAt = this.time.now();
      const offer = offerAmount(
        pkg.price,
        offerOf(pkg),
        this.time.localDate(soldAt),
      );
      const price = subMoney(pkg.price, offer);
      const invoice = await this.invoices.createForPackage(
        manager,
        {
          patientId,
          description: `Package: ${pkg.name} (${pkg.sessionsCount} sessions)`,
          price,
        },
        actor,
      );
      const repository = manager.getRepository(PatientPackage);
      const pp = await repository.save(
        repository.create({
          patientId,
          packageId: pkg.id,
          serviceId: pkg.serviceId,
          name: pkg.name,
          listPrice: pkg.price,
          offerAmount: offer,
          price,
          totalSessions: pkg.sessionsCount,
          usedSessions: 0,
          invoiceId: invoice.id,
          status: PatientPackageStatus.ACTIVE,
          soldById: actor.userId as string,
          soldAt,
          cancelledAt: null,
          cancelledById: null,
          cancelReason: null,
        }),
      );
      await this.audit(manager, actor, AuditAction.PACKAGE_SOLD, pp.id, {
        newValues: {
          patientId,
          packageId: pkg.id,
          name: pkg.name,
          serviceId: pkg.serviceId,
          totalSessions: pp.totalSessions,
          listPrice: pp.listPrice,
          offerAmount: pp.offerAmount,
          price: pp.price,
          invoiceId: invoice.id,
        },
      });
      return pp.id;
    });
    return this.loadDetail(id, true);
  }

  // OWNER: the remaining sessions can't be used any more. Money goes back,
  // if at all, through the normal refund flow.
  async cancel(
    id: string,
    reason: string,
    actor: Actor,
  ): Promise<PatientPackageDetailDto> {
    await this.dataSource.transaction(async (manager) => {
      const pp = await this.lock(id, manager);
      if (pp.status === PatientPackageStatus.CANCELLED) {
        throw unprocessable(
          ErrorCode.PACKAGE_CANCELLED,
          'The package is already cancelled',
        );
      }
      const from = pp.status;
      pp.status = PatientPackageStatus.CANCELLED;
      pp.cancelledAt = this.time.now();
      pp.cancelledById = actor.userId;
      pp.cancelReason = reason;
      await manager.getRepository(PatientPackage).save(pp);
      await this.audit(manager, actor, AuditAction.PACKAGE_CANCELLED, pp.id, {
        oldValues: { status: from },
        newValues: { status: pp.status, reason },
      });
    });
    return this.loadDetail(id, true);
  }

  // Gives back a session used by a no-show (an attended one is given back
  // by undoing the attendance).
  async restoreUsage(
    usageId: string,
    reason: string,
    actor: Actor,
  ): Promise<PatientPackageDetailDto> {
    const patientPackageId = await this.dataSource.transaction(
      async (manager) => {
        const usage = await manager.findOneBy(PackageUsage, { id: usageId });
        if (!usage) throw new NotFoundException('Package usage not found');
        if (usage.reason !== PackageUsageReason.NO_SHOW) {
          throw unprocessable(
            ErrorCode.RESTORE_NOT_ALLOWED,
            'Only a no-show session can be restored; undo the attendance instead',
          );
        }
        const restored = await this.restoreLocked(
          manager,
          usage,
          reason,
          actor,
        );
        if (!restored) {
          throw unprocessable(
            ErrorCode.RESTORE_NOT_ALLOWED,
            'This session is already restored',
          );
        }
        return usage.patientPackageId;
      },
    );
    return this.loadDetail(patientPackageId, true);
  }

  // ---------- Used by attend, walk-in, no-show and their undo ----------

  /**
   * Attend / walk-in, in the caller's transaction (after the visit insert,
   * before its invoice, which then gets a 0.00 line). Uses the chosen
   * package, or the oldest usable one, or none.
   */
  async useForVisit(
    manager: EntityManager,
    visit: Visit,
    choice: PackageChoiceDto,
    actor: Actor,
  ): Promise<void> {
    if (choice.usePackage === false) return;
    const pp = await this.pick(manager, visit, choice.patientPackageId);
    if (!pp) return;
    await this.useSession(
      manager,
      pp,
      { reason: PackageUsageReason.ATTENDED, visitId: visit.id },
      actor,
    );
  }

  // No-show: the oldest usable package pays the missed session.
  async useForNoShow(
    manager: EntityManager,
    appointment: Appointment,
    actor: Actor,
  ): Promise<void> {
    const pp = await this.pick(manager, appointment);
    if (!pp) return;
    await this.useSession(
      manager,
      pp,
      { reason: PackageUsageReason.NO_SHOW, appointmentId: appointment.id },
      actor,
    );
  }

  // Undo attend (and walk-in undo): the visit's session comes back.
  async restoreForVisit(
    manager: EntityManager,
    visitId: string,
    reason: string,
    actor: Actor,
  ): Promise<void> {
    const usage = await manager.findOneBy(PackageUsage, {
      visitId,
      restoredAt: IsNull(),
    });
    if (usage) await this.restoreLocked(manager, usage, reason, actor);
  }

  // Undo no-show: the no-show's session comes back.
  async restoreForAppointment(
    manager: EntityManager,
    appointmentId: string,
    reason: string,
    actor: Actor,
  ): Promise<void> {
    const usage = await manager.findOneBy(PackageUsage, {
      appointmentId,
      restoredAt: IsNull(),
    });
    if (usage) await this.restoreLocked(manager, usage, reason, actor);
  }

  // The sessions (not restored) used by these visits and appointments.
  async activeSessions(
    visitIds: string[],
    appointmentIds: string[],
  ): Promise<{
    byVisit: Map<string, PackageSessionDto>;
    byAppointment: Map<string, PackageSessionDto>;
  }> {
    const byVisit = new Map<string, PackageSessionDto>();
    const byAppointment = new Map<string, PackageSessionDto>();
    if (visitIds.length === 0 && appointmentIds.length === 0) {
      return { byVisit, byAppointment };
    }
    const where = [
      ...(visitIds.length ? [{ visitId: In(visitIds) }] : []),
      ...(appointmentIds.length ? [{ appointmentId: In(appointmentIds) }] : []),
    ].map((condition) => ({ ...condition, restoredAt: IsNull() }));
    const usages = await this.usages.find({
      where,
      relations: { patientPackage: true },
    });
    for (const usage of usages) {
      const session = toPackageSession(usage);
      if (usage.visitId) byVisit.set(usage.visitId, session);
      if (usage.appointmentId) byAppointment.set(usage.appointmentId, session);
    }
    return { byVisit, byAppointment };
  }

  // ---------- Queries ----------

  // Newest first. A DOCTOR (who treats the patient) gets no prices.
  async forPatient(
    patientId: string,
    user: AuthenticatedUser,
  ): Promise<PatientPackageDto[]> {
    await this.access.assertCanAccessPatient(user, patientId);
    const rows = await this.detailQuery()
      .where('pp.patientId = :patientId', { patientId })
      .orderBy('pp.soldAt', 'DESC')
      .addOrderBy('pp.id', 'DESC')
      .getMany();
    const withPrices = user.role !== UserRole.DOCTOR;
    return rows.map((pp) =>
      toPatientPackage(pp, withPrices ? (pp.invoice ?? null) : null, (d) =>
        this.time.toIso(d),
      ),
    );
  }

  async findOne(
    id: string,
    user: AuthenticatedUser,
  ): Promise<PatientPackageDetailDto> {
    const pp = await this.patientPackages.findOneBy({ id });
    if (!pp) throw new NotFoundException('Package not found');
    // 404 too for a doctor who doesn't treat the patient.
    await this.access.assertCanAccessPatient(user, pp.patientId);
    return this.loadDetail(id, user.role !== UserRole.DOCTOR);
  }

  // ---------- Internals ----------

  /**
   * The package paying a session, locked: the chosen one (422 when it can't
   * pay for this target), else the oldest usable one, else null. FOR UPDATE
   * re-checks the conditions after waiting, so of two parallel attends on
   * the last session only one gets the package.
   */
  private async pick(
    manager: EntityManager,
    target: SessionTarget,
    chosenId?: string,
  ): Promise<PatientPackage | null> {
    if (chosenId) {
      const pp = await manager.findOne(PatientPackage, {
        where: { id: chosenId, patientId: target.patientId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!pp) throw new NotFoundException('Package not found');
      const problem = await this.unusable(manager, pp, target);
      if (problem) throw unprocessable(ErrorCode.PACKAGE_NOT_USABLE, problem);
      return pp;
    }
    const candidates = await manager
      .getRepository(PatientPackage)
      .createQueryBuilder('pp')
      .where('pp.patientId = :patientId', { patientId: target.patientId })
      .andWhere('pp.serviceId = :serviceId', { serviceId: target.serviceId })
      .andWhere('pp.status = :active', { active: PatientPackageStatus.ACTIVE })
      .andWhere(DOCTOR_ALLOWED, { doctorId: target.doctorId })
      .orderBy('pp.soldAt', 'ASC')
      .addOrderBy('pp.id', 'ASC')
      .setLock('pessimistic_write')
      .getMany();
    return candidates[0] ?? null;
  }

  // Why `pp` can't pay for `target`, or null.
  private async unusable(
    manager: EntityManager,
    pp: PatientPackage,
    target: SessionTarget,
  ): Promise<string | null> {
    if (pp.status === PatientPackageStatus.CANCELLED) {
      return 'The package is cancelled';
    }
    if (pp.status === PatientPackageStatus.FINISHED) {
      return 'The package has no sessions left';
    }
    if (pp.serviceId !== target.serviceId) {
      return 'The package is for another service';
    }
    const pkg = await manager.findOneByOrFail(Package, { id: pp.packageId });
    const allowed =
      pkg.allDoctors ||
      (await manager.existsBy(PackageDoctor, {
        packageId: pkg.id,
        doctorId: target.doctorId,
      }));
    return allowed ? null : "The package doesn't cover this doctor";
  }

  // `pp` is locked by the caller and has a session left (ACTIVE).
  private async useSession(
    manager: EntityManager,
    pp: PatientPackage,
    source: {
      reason: PackageUsageReason;
      visitId?: string;
      appointmentId?: string;
    },
    actor: Actor,
  ): Promise<void> {
    const before = pp.usedSessions;
    pp.usedSessions += 1;
    if (pp.usedSessions === pp.totalSessions) {
      pp.status = PatientPackageStatus.FINISHED;
    }
    await manager.getRepository(PatientPackage).save(pp);
    const usage = await manager.getRepository(PackageUsage).save(
      manager.getRepository(PackageUsage).create({
        patientPackageId: pp.id,
        reason: source.reason,
        visitId: source.visitId ?? null,
        appointmentId: source.appointmentId ?? null,
        usedAt: this.time.now(),
        usedById: actor.userId as string,
        restoredAt: null,
        restoredById: null,
        restoreReason: null,
      }),
    );
    await this.audit(manager, actor, AuditAction.PACKAGE_SESSION_USED, pp.id, {
      oldValues: { usedSessions: before },
      newValues: {
        usedSessions: pp.usedSessions,
        status: pp.status,
        usageId: usage.id,
        reason: usage.reason,
        visitId: usage.visitId,
        appointmentId: usage.appointmentId,
      },
    });
  }

  /**
   * Locks the usage's package, then restores the usage if it is still not
   * restored (re-read under the lock). Returns false when it already was.
   */
  private async restoreLocked(
    manager: EntityManager,
    found: PackageUsage,
    reason: string,
    actor: Actor,
  ): Promise<boolean> {
    const pp = await this.lock(found.patientPackageId, manager);
    const usage = await manager.findOneBy(PackageUsage, {
      id: found.id,
      restoredAt: IsNull(),
    });
    if (!usage) return false;

    usage.restoredAt = this.time.now();
    usage.restoredById = actor.userId;
    usage.restoreReason = reason;
    await manager.getRepository(PackageUsage).save(usage);

    const before = pp.usedSessions;
    pp.usedSessions -= 1;
    if (pp.status === PatientPackageStatus.FINISHED) {
      pp.status = PatientPackageStatus.ACTIVE;
    }
    await manager.getRepository(PatientPackage).save(pp);
    await this.audit(
      manager,
      actor,
      AuditAction.PACKAGE_SESSION_RESTORED,
      pp.id,
      {
        oldValues: { usedSessions: before },
        newValues: {
          usedSessions: pp.usedSessions,
          status: pp.status,
          usageId: usage.id,
          reason,
        },
      },
    );
    return true;
  }

  private async lock(
    id: string,
    manager: EntityManager,
  ): Promise<PatientPackage> {
    const pp = await manager.findOne(PatientPackage, {
      where: { id },
      lock: { mode: 'pessimistic_write' },
    });
    if (!pp) throw new NotFoundException('Package not found');
    return pp;
  }

  private async loadDetail(
    id: string,
    withPrices: boolean,
  ): Promise<PatientPackageDetailDto> {
    const pp = await this.detailQuery()
      .where('pp.id = :id', { id })
      .getOneOrFail();
    const usages = await this.usages.find({
      where: { patientPackageId: id },
      relations: {
        usedBy: true,
        restoredBy: true,
        visit: { doctor: { user: true } },
        appointment: { doctor: { user: true } },
      },
      order: { usedAt: 'ASC', id: 'ASC' },
    });
    const toIso = (d: Date) => this.time.toIso(d);
    return {
      ...toPatientPackage(pp, withPrices ? (pp.invoice ?? null) : null, toIso),
      usages: usages.map((usage) => toPackageUsage(usage, toIso)),
    };
  }

  private detailQuery(): SelectQueryBuilder<PatientPackage> {
    return this.patientPackages
      .createQueryBuilder('pp')
      .innerJoinAndSelect('pp.service', 'service')
      .innerJoinAndSelect('pp.soldBy', 'soldBy')
      .leftJoinAndSelect('pp.cancelledBy', 'cancelledBy')
      .innerJoinAndSelect('pp.invoice', 'invoice')
      .innerJoinAndSelect('pp.package', 'pkg')
      .leftJoinAndSelect('pkg.doctors', 'link')
      .leftJoinAndSelect('link.doctor', 'doctor')
      .leftJoinAndSelect('doctor.user', 'doctorUser');
  }

  private audit(
    manager: EntityManager,
    actor: Actor,
    action: AuditAction,
    patientPackageId: string,
    values: Parameters<AuditService['logAction']>[4],
  ): Promise<void> {
    return this.auditService.logAction(
      actor,
      action,
      AuditEntityType.PATIENT_PACKAGE,
      patientPackageId,
      values,
      manager,
    );
  }
}
