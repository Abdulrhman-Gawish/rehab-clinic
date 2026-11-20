import { randomUUID } from 'node:crypto';
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import {
  Brackets,
  DataSource,
  EntityManager,
  In,
  MoreThanOrEqual,
  Not,
} from 'typeorm';
import { UserRefDto } from '../../common/dto/user-ref.dto.js';
import { ErrorCode, unprocessable } from '../../common/errors/app.exception.js';
import type { Actor } from '../../common/interfaces/authenticated-request.interface.js';
import { ClinicTimeService } from '../../common/time/clinic-time.service.js';
import {
  addMoney,
  compareMoney,
  subMoney,
  toMoney,
  ZERO,
} from '../../common/utils/money.util.js';
import { AuditAction, AuditEntityType } from '../audit/audit.constants.js';
import { AuditService } from '../audit/audit.service.js';
import { InvoiceStatus, PaymentStatus } from '../billing/billing.enums.js';
import { Invoice } from '../billing/entities/invoice.entity.js';
import { ClinicService } from '../clinic-services/entities/clinic-service.entity.js';
import { Doctor } from '../doctors/entities/doctor.entity.js';
import { ExpensesService } from '../expenses/expenses.service.js';
import { PackageUsage } from '../packages/entities/package-usage.entity.js';
import { PackageUsageReason } from '../packages/packages.enums.js';
import { Visit } from '../visits/entities/visit.entity.js';
import { VisitStatus } from '../visits/visit.enums.js';
import type {
  RecordSalaryPaymentDto,
  SalaryOverviewRowDto,
  SalaryPaymentDto,
  SalarySessionDto,
  SalaryStatementDto,
  SalaryTermsDto,
  SetSalaryTermsDto,
} from './dto/salaries.dto.js';
import { DoctorSalaryPayment } from './entities/doctor-salary-payment.entity.js';
import { DoctorSalaryServiceRate } from './entities/doctor-salary-service-rate.entity.js';
import { DoctorSalaryTerms } from './entities/doctor-salary-terms.entity.js';
import {
  SalaryCommissionMode,
  SalaryRateType,
  SessionValueSource,
} from './salaries.enums.js';
import {
  commissionOf,
  monthDates,
  packageSessionValue,
  rateFor,
  termsForMonth,
} from './salary-math.js';

const TERMS_RELATIONS = { serviceRates: { service: true }, setBy: true };
const PAYMENT_RELATIONS = {
  doctor: { user: true },
  expense: true,
  paidBy: true,
  voidedBy: true,
};

/**
 * Doctors' pay (OWNER only). Terms are versioned by month; a month's
 * statement is computed live from that month's attended sessions (ACTIVE
 * visits: an undone or voided visit drops out), so nothing is stored per
 * session. Payments (advances and parts allowed) are clinic expenses.
 */
@Injectable()
export class SalariesService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
    private readonly expenses: ExpensesService,
    private readonly time: ClinicTimeService,
  ) {}

  // ---------- Terms ----------

  // Every version, newest first.
  async listTerms(doctorId: string): Promise<SalaryTermsDto[]> {
    await this.doctor(doctorId);
    const versions = await this.dataSource
      .getRepository(DoctorSalaryTerms)
      .find({
        where: { doctorId },
        relations: TERMS_RELATIONS,
        order: { effectiveMonth: 'DESC' },
      });
    return versions.map((v) => this.toTerms(v));
  }

  async setTerms(
    doctorId: string,
    dto: SetSalaryTermsDto,
    actor: Actor,
  ): Promise<SalaryTermsDto> {
    const sessionRate = dto.sessionRate ?? null;
    const serviceRates = dto.serviceRates ?? [];
    const invalid = (message: string) =>
      unprocessable(ErrorCode.SALARY_TERMS_INVALID, message);
    if (dto.commissionMode === SalaryCommissionMode.PER_SESSION) {
      if (!sessionRate) throw invalid('PER_SESSION needs sessionRate');
      if (serviceRates.length)
        throw invalid('serviceRates are only for PER_SERVICE');
    } else if (dto.commissionMode === SalaryCommissionMode.PER_SERVICE) {
      if (!serviceRates.length)
        throw invalid('PER_SERVICE needs at least one service rate');
      if (sessionRate) throw invalid('sessionRate is only for PER_SESSION');
    } else if (sessionRate || serviceRates.length) {
      throw invalid('NONE takes no rates');
    }
    const rates = [...(sessionRate ? [sessionRate] : []), ...serviceRates];
    if (
      rates.some(
        (r) =>
          r.type === SalaryRateType.PERCENT && compareMoney(r.value, '100') > 0,
      )
    ) {
      throw invalid('A percentage is at most 100');
    }
    const serviceIds = serviceRates.map((r) => r.serviceId);
    if (new Set(serviceIds).size !== serviceIds.length) {
      throw invalid('Each service can have only one rate');
    }

    const id = await this.dataSource.transaction(async (manager) => {
      // Serializes terms changes and payments of the doctor.
      await this.doctor(doctorId, manager, true);
      if (serviceIds.length) {
        const found = await manager.countBy(ClinicService, {
          id: In(serviceIds),
        });
        if (found !== serviceIds.length)
          throw new NotFoundException('Service not found');
      }
      const paid = await manager.findOne(DoctorSalaryPayment, {
        where: {
          doctorId,
          status: PaymentStatus.VALID,
          month: MoreThanOrEqual(dto.effectiveMonth),
        },
        order: { month: 'DESC' },
      });
      if (paid) {
        throw unprocessable(
          ErrorCode.SALARY_MONTH_PAID,
          `${paid.month} already has a salary payment: new terms can start after it`,
          { paidMonth: paid.month },
        );
      }
      const old = await manager.findOne(DoctorSalaryTerms, {
        where: { doctorId, effectiveMonth: dto.effectiveMonth },
        relations: { serviceRates: true },
      });
      if (old) await manager.delete(DoctorSalaryTerms, { id: old.id });
      const termsId = randomUUID();
      await manager.insert(DoctorSalaryTerms, {
        id: termsId,
        doctorId,
        effectiveMonth: dto.effectiveMonth,
        fixedSalary: toMoney(dto.fixedSalary),
        commissionMode: dto.commissionMode,
        sessionRateType: sessionRate?.type ?? null,
        sessionRateValue: sessionRate ? toMoney(sessionRate.value) : null,
        setById: actor.userId as string,
      });
      if (serviceRates.length) {
        await manager.insert(
          DoctorSalaryServiceRate,
          serviceRates.map((r) => ({
            termsId,
            serviceId: r.serviceId,
            rateType: r.type,
            value: toMoney(r.value),
          })),
        );
      }
      await this.auditService.logAction(
        actor,
        AuditAction.DOCTOR_SALARY_TERMS_SET,
        AuditEntityType.DOCTOR_SALARY_TERMS,
        termsId,
        {
          oldValues: old ? this.termsValues(old) : undefined,
          newValues: {
            doctorId,
            effectiveMonth: dto.effectiveMonth,
            fixedSalary: toMoney(dto.fixedSalary),
            commissionMode: dto.commissionMode,
            sessionRate,
            serviceRates,
          },
        },
        manager,
      );
      return termsId;
    });
    const saved = await this.dataSource
      .getRepository(DoctorSalaryTerms)
      .findOneOrFail({
        where: { id },
        relations: TERMS_RELATIONS,
      });
    return this.toTerms(saved);
  }

  // ---------- Statement ----------

  async statement(
    doctorId: string,
    month: string,
  ): Promise<SalaryStatementDto> {
    const doctor = await this.doctor(doctorId);
    const versions = await this.dataSource
      .getRepository(DoctorSalaryTerms)
      .find({
        where: { doctorId },
        relations: TERMS_RELATIONS,
      });
    const terms = termsForMonth(versions, month);
    const sessions = await this.sessions(doctorId, month, terms);
    const payments = await this.dataSource
      .getRepository(DoctorSalaryPayment)
      .find({
        where: { doctorId, month },
        relations: PAYMENT_RELATIONS,
        order: { paymentDate: 'DESC', paidAt: 'DESC' },
      });
    const fixedSalary = terms ? toMoney(terms.fixedSalary) : ZERO;
    const commissionTotal = addMoney(
      ZERO,
      ...sessions.map((s) => s.commission),
    );
    const earned = addMoney(fixedSalary, commissionTotal);
    const paid = addMoney(
      ZERO,
      ...payments
        .filter((p) => p.status === PaymentStatus.VALID)
        .map((p) => p.amount),
    );
    return {
      doctor: { id: doctor.id, name: doctor.user.name },
      month,
      terms: terms ? this.toTerms(terms) : null,
      fixedSalary,
      sessionCount: sessions.length,
      commissionTotal,
      earned,
      paid,
      remaining: subMoney(earned, paid),
      sessions,
      payments: payments.map((p) => this.toPayment(p)),
    };
  }

  // Every doctor that is not deleted (or that has terms / payments in the
  // month), with the month's totals.
  async overview(month: string): Promise<SalaryOverviewRowDto[]> {
    const { first } = monthDates(month);
    const doctors = await this.dataSource
      .getRepository(Doctor)
      .createQueryBuilder('doctor')
      .innerJoinAndSelect('doctor.user', 'user')
      .where(
        new Brackets((qb) =>
          qb
            .where('doctor.deletedAt IS NULL')
            .orWhere('doctor.deletedAt >= :first', { first })
            .orWhere(
              'EXISTS (SELECT 1 FROM doctor_salary_payments p WHERE p.doctor_id = doctor.id AND p.month = :month)',
              { month },
            ),
        ),
      )
      .orderBy('user.name', 'ASC')
      .getMany();
    const rows: SalaryOverviewRowDto[] = [];
    for (const doctor of doctors) {
      const s = await this.statement(doctor.id, month);
      rows.push({
        doctor: s.doctor,
        isActive: doctor.isActive && doctor.deletedAt === null,
        commissionMode: s.terms?.commissionMode ?? null,
        hasTerms: s.terms !== null,
        fixedSalary: s.fixedSalary,
        sessionCount: s.sessionCount,
        commissionTotal: s.commissionTotal,
        earned: s.earned,
        paid: s.paid,
        remaining: s.remaining,
      });
    }
    return rows;
  }

  // ---------- Payments ----------

  async recordPayment(
    doctorId: string,
    dto: RecordSalaryPaymentDto,
    actor: Actor,
  ): Promise<SalaryPaymentDto> {
    const thisMonth = this.time.today().slice(0, 7);
    if (dto.month > thisMonth) {
      throw unprocessable(
        ErrorCode.DATE_OUT_OF_RANGE,
        `month must be ${thisMonth} or earlier`,
        { to: thisMonth },
      );
    }
    const id = await this.dataSource.transaction(async (manager) => {
      const doctor = await this.doctor(doctorId, manager, true);
      const paymentId = randomUUID();
      const paymentDate = dto.paymentDate ?? this.time.today();
      const reference = dto.reference ?? null;
      const amount = toMoney(dto.amount);
      const expense = await this.expenses.createForSalaryPayment(
        manager,
        {
          salaryPaymentId: paymentId,
          doctorName: doctor.user.name,
          month: dto.month,
          amount,
          date: paymentDate,
          method: dto.method,
          reference,
        },
        actor,
      );
      await manager.insert(DoctorSalaryPayment, {
        id: paymentId,
        doctorId,
        month: dto.month,
        amount,
        paymentDate,
        method: dto.method,
        expenseId: expense.id,
        reference,
        notes: dto.notes ?? null,
        status: PaymentStatus.VALID,
        paidById: actor.userId as string,
        paidAt: this.time.now(),
        voidedAt: null,
        voidedById: null,
        voidReason: null,
      });
      await this.auditService.logAction(
        actor,
        AuditAction.DOCTOR_SALARY_PAID,
        AuditEntityType.DOCTOR_SALARY_PAYMENT,
        paymentId,
        {
          newValues: {
            doctorId,
            month: dto.month,
            amount,
            paymentDate,
            method: dto.method,
            reference,
            notes: dto.notes ?? null,
            expenseId: expense.id,
            expenseNumber: expense.expenseNumber,
          },
        },
        manager,
      );
      return paymentId;
    });
    return this.payment(id);
  }

  // A payment recorded by mistake: it no longer counts, and its expense is
  // voided with it.
  async voidPayment(
    id: string,
    reason: string,
    actor: Actor,
  ): Promise<SalaryPaymentDto> {
    await this.dataSource.transaction(async (manager) => {
      const found = await manager.findOneBy(DoctorSalaryPayment, { id });
      if (!found) throw new NotFoundException('Salary payment not found');
      await this.doctor(found.doctorId, manager, true);
      const payment = await manager.findOneOrFail(DoctorSalaryPayment, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (payment.status === PaymentStatus.VOIDED) {
        throw unprocessable(
          ErrorCode.PAYOUT_VOIDED,
          'The payment is already voided',
        );
      }
      payment.status = PaymentStatus.VOIDED;
      payment.voidedAt = this.time.now();
      payment.voidedById = actor.userId;
      payment.voidReason = reason;
      await manager.getRepository(DoctorSalaryPayment).save(payment);
      await this.expenses.voidForPayout(
        manager,
        payment.expenseId,
        reason,
        actor,
      );
      await this.auditService.logAction(
        actor,
        AuditAction.DOCTOR_SALARY_PAYMENT_VOIDED,
        AuditEntityType.DOCTOR_SALARY_PAYMENT,
        id,
        {
          oldValues: { status: PaymentStatus.VALID },
          newValues: {
            status: payment.status,
            reason,
            expenseId: payment.expenseId,
          },
        },
        manager,
      );
    });
    return this.payment(id);
  }

  // ---------- Internals ----------

  /**
   * The month's attended sessions with what each earns. A session's value is
   * its live invoice total (after discount), or package price / sessions
   * when a package session paid for it.
   */
  private async sessions(
    doctorId: string,
    month: string,
    terms: DoctorSalaryTerms | null,
  ): Promise<SalarySessionDto[]> {
    const { first, last } = monthDates(month);
    const start = this.time.dayBounds(first).start;
    const end = this.time.dayBounds(last).end;
    const visits = await this.dataSource
      .getRepository(Visit)
      .createQueryBuilder('visit')
      .innerJoinAndSelect('visit.patient', 'patient')
      .innerJoinAndSelect('visit.service', 'service')
      .where('visit.doctorId = :doctorId', { doctorId })
      .andWhere('visit.status = :active', { active: VisitStatus.ACTIVE })
      .andWhere('visit.attendedAt >= :start AND visit.attendedAt < :end', {
        start,
        end,
      })
      .orderBy('visit.attendedAt', 'ASC')
      .getMany();
    if (visits.length === 0) return [];
    const ids = visits.map((v) => v.id);
    const invoices = await this.dataSource.getRepository(Invoice).find({
      where: { visitId: In(ids), status: Not(InvoiceStatus.CANCELLED) },
    });
    const invoiceByVisit = new Map(
      invoices.map((i) => [i.visitId as string, i]),
    );
    const usages = await this.dataSource.getRepository(PackageUsage).find({
      where: { visitId: In(ids), reason: PackageUsageReason.ATTENDED },
      relations: { patientPackage: true },
    });
    const packageByVisit = new Map(
      usages
        .filter((u) => u.restoredAt === null)
        .map((u) => [u.visitId as string, u]),
    );
    const toIso = (d: Date) => this.time.toIso(d);
    return visits.map((visit) => {
      const usage = packageByVisit.get(visit.id);
      const invoice = invoiceByVisit.get(visit.id);
      let sessionValue = ZERO;
      let valueSource = SessionValueSource.NONE;
      if (usage?.patientPackage) {
        sessionValue = packageSessionValue(
          usage.patientPackage.price,
          usage.patientPackage.totalSessions,
        );
        valueSource = SessionValueSource.PACKAGE;
      } else if (invoice) {
        sessionValue = toMoney(invoice.total);
        valueSource = SessionValueSource.INVOICE;
      }
      const rate = rateFor(terms, visit.serviceId);
      return {
        visitId: visit.id,
        attendedAt: toIso(visit.attendedAt),
        patient: { id: visit.patient!.id, name: visit.patient!.name },
        service: { id: visit.service!.id, name: visit.service!.name },
        sessionValue,
        valueSource,
        rate,
        commission: commissionOf(rate, sessionValue),
      };
    });
  }

  private async doctor(
    id: string,
    manager?: EntityManager,
    lock = false,
  ): Promise<Doctor> {
    const m = manager ?? this.dataSource.manager;
    if (lock) {
      const locked = await m.findOne(Doctor, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!locked) throw new NotFoundException('Doctor not found');
    }
    const doctor = await m.findOne(Doctor, {
      where: { id },
      relations: { user: true },
    });
    if (!doctor) throw new NotFoundException('Doctor not found');
    return doctor;
  }

  private async payment(id: string): Promise<SalaryPaymentDto> {
    const payment = await this.dataSource
      .getRepository(DoctorSalaryPayment)
      .findOne({
        where: { id },
        relations: PAYMENT_RELATIONS,
      });
    if (!payment) throw new NotFoundException('Salary payment not found');
    return this.toPayment(payment);
  }

  private termsValues(t: DoctorSalaryTerms) {
    return {
      effectiveMonth: t.effectiveMonth,
      fixedSalary: toMoney(t.fixedSalary),
      commissionMode: t.commissionMode,
      sessionRate: t.sessionRateType
        ? {
            type: t.sessionRateType,
            value: toMoney(t.sessionRateValue as string),
          }
        : null,
      serviceRates: (t.serviceRates ?? []).map((r) => ({
        serviceId: r.serviceId,
        type: r.rateType,
        value: toMoney(r.value),
      })),
    };
  }

  private toTerms(t: DoctorSalaryTerms): SalaryTermsDto {
    return {
      id: t.id,
      effectiveMonth: t.effectiveMonth,
      fixedSalary: toMoney(t.fixedSalary),
      commissionMode: t.commissionMode,
      sessionRate:
        t.sessionRateType && t.sessionRateValue !== null
          ? { type: t.sessionRateType, value: toMoney(t.sessionRateValue) }
          : null,
      serviceRates: (t.serviceRates ?? [])
        .map((r) => ({
          service: { id: r.serviceId, name: r.service?.name ?? '' },
          type: r.rateType,
          value: toMoney(r.value),
        }))
        .sort((a, b) => a.service.name.localeCompare(b.service.name)),
      setBy: UserRefDto.fromEntity(t.setBy),
      setAt: this.time.toIso(t.createdAt),
    };
  }

  private toPayment(p: DoctorSalaryPayment): SalaryPaymentDto {
    const toIso = (d: Date) => this.time.toIso(d);
    return {
      id: p.id,
      doctor: { id: p.doctorId, name: p.doctor?.user?.name ?? '' },
      month: p.month,
      amount: toMoney(p.amount),
      paymentDate: p.paymentDate,
      method: p.method,
      reference: p.reference,
      notes: p.notes,
      status: p.status,
      expense: {
        id: p.expenseId,
        expenseNumber: p.expense?.expenseNumber ?? '',
      },
      paidBy: UserRefDto.fromEntity(p.paidBy),
      paidAt: toIso(p.paidAt),
      voidedAt: p.voidedAt ? toIso(p.voidedAt) : null,
      voidedBy: UserRefDto.fromNullable(p.voidedBy),
      voidReason: p.voidReason,
    };
  }
}
