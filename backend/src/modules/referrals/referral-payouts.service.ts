import { randomUUID } from 'node:crypto';
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, In } from 'typeorm';
import { ErrorCode, unprocessable } from '../../common/errors/app.exception.js';
import type { Actor } from '../../common/interfaces/authenticated-request.interface.js';
import { ClinicTimeService } from '../../common/time/clinic-time.service.js';
import {
  addMoney,
  compareMoney,
  isPositiveMoney,
  isZeroMoney,
  subMoney,
  toMoney,
  ZERO,
} from '../../common/utils/money.util.js';
import { AuditAction, AuditEntityType } from '../audit/audit.constants.js';
import { AuditService } from '../audit/audit.service.js';
import { PaymentStatus } from '../billing/billing.enums.js';
import { ExpensesService } from '../expenses/expenses.service.js';
import type { PayoutDto, RecordPayoutDto } from './dto/referrals.dto.js';
import { ReferralCommission } from './entities/referral-commission.entity.js';
import { ReferralPayoutAllocation } from './entities/referral-payout-allocation.entity.js';
import { ReferralPayout } from './entities/referral-payout.entity.js';
import { ReferringDoctor } from './entities/referring-doctor.entity.js';
import { paidAmounts } from './referral-commissions.service.js';
import { allocatePayout } from './referral-math.js';
import { toPayout } from './referral.mapper.js';
import { CommissionStatus } from './referrals.enums.js';

const RELATIONS = {
  referringDoctor: true,
  paidBy: true,
  voidedBy: true,
  expense: true,
};

/**
 * Money paid to referring doctors (OWNER only): any amount up to what is
 * owed, so a doctor can be paid in parts. Each payout settles commission
 * rows oldest first (allocations) and writes its clinic expense in the
 * same transaction, so the cash summary and the owner reports count it
 * exactly once, through the expense.
 */
@Injectable()
export class ReferralPayoutsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
    private readonly expenses: ExpensesService,
    private readonly time: ClinicTimeService,
  ) {}

  async record(
    referringDoctorId: string,
    dto: RecordPayoutDto,
    actor: Actor,
  ): Promise<PayoutDto> {
    const id = await this.dataSource.transaction(async (manager) => {
      // Serializes payouts and voids of the doctor: two payouts at once
      // can never pay the same money twice.
      const doctor = await manager.findOne(ReferringDoctor, {
        where: { id: referringDoctorId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!doctor) throw new NotFoundException('Referring doctor not found');
      const rows = await manager.find(ReferralCommission, {
        where: { referringDoctorId, status: CommissionStatus.ELIGIBLE },
        order: { eligibleAt: 'ASC', recordedAt: 'ASC', id: 'ASC' },
        lock: { mode: 'pessimistic_write' },
      });
      const paid = await paidAmounts(
        manager,
        rows.map((r) => r.id),
      );
      const open = rows
        .map((r) => ({
          id: r.id,
          remaining: subMoney(r.amount, paid.get(r.id) ?? ZERO),
        }))
        .filter((r) => !isZeroMoney(r.remaining));
      const outstanding = addMoney(ZERO, ...open.map((r) => r.remaining));
      if (!isPositiveMoney(outstanding)) {
        throw unprocessable(
          ErrorCode.NOTHING_TO_PAY,
          'Nothing is owed to this doctor',
          { outstanding },
        );
      }
      const amount = toMoney(dto.amount);
      if (compareMoney(amount, outstanding) > 0) {
        throw unprocessable(
          ErrorCode.PAYOUT_EXCEEDS_OUTSTANDING,
          `At most ${outstanding} is owed to this doctor`,
          { outstanding },
        );
      }
      const allocations = allocatePayout(open, amount);

      const payoutId = randomUUID();
      const payoutDate = dto.payoutDate ?? this.time.today();
      const reference = dto.reference ?? null;
      const expense = await this.expenses.createForPayout(
        manager,
        {
          payoutId,
          doctorName: doctor.name,
          amount,
          date: payoutDate,
          method: dto.method,
          reference,
        },
        actor,
      );
      await manager.insert(ReferralPayout, {
        id: payoutId,
        referringDoctorId,
        amount,
        payoutDate,
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
      await manager.insert(
        ReferralPayoutAllocation,
        allocations.map((a) => ({ payoutId, ...a })),
      );
      // Rows this payout finished paying.
      const remaining = new Map(open.map((r) => [r.id, r.remaining]));
      const settled = allocations
        .filter(
          (a) => compareMoney(a.amount, remaining.get(a.commissionId)!) === 0,
        )
        .map((a) => a.commissionId);
      if (settled.length) {
        await manager
          .getRepository(ReferralCommission)
          .update(
            { id: In(settled) },
            { status: CommissionStatus.PAID, payoutId },
          );
      }
      await this.audit(
        manager,
        actor,
        AuditAction.REFERRAL_PAYOUT_RECORDED,
        payoutId,
        {
          newValues: {
            referringDoctorId,
            amount,
            payoutDate,
            method: dto.method,
            reference,
            notes: dto.notes ?? null,
            outstandingBefore: outstanding,
            expenseId: expense.id,
            expenseNumber: expense.expenseNumber,
            allocations,
          },
        },
      );
      return payoutId;
    });
    return this.findOne(id);
  }

  // A payout recorded by mistake: what it paid is owed again, and its
  // expense is voided with it.
  async void(id: string, reason: string, actor: Actor): Promise<PayoutDto> {
    await this.dataSource.transaction(async (manager) => {
      const found = await manager.findOneBy(ReferralPayout, { id });
      if (!found) throw new NotFoundException('Payout not found');
      await manager.findOne(ReferringDoctor, {
        where: { id: found.referringDoctorId },
        lock: { mode: 'pessimistic_write' },
      });
      const payout = await manager.findOneOrFail(ReferralPayout, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (payout.status === PaymentStatus.VOIDED) {
        throw unprocessable(
          ErrorCode.PAYOUT_VOIDED,
          'The payout is already voided',
        );
      }
      // The allocations stay (history) but no longer count.
      const allocations = await manager.find(ReferralPayoutAllocation, {
        where: { payoutId: id },
      });
      const ids = allocations.map((a) => a.commissionId);
      if (ids.length) {
        // Rows it helped finish are not fully paid any more.
        await manager
          .getRepository(ReferralCommission)
          .update(
            { id: In(ids), status: CommissionStatus.PAID },
            { status: CommissionStatus.ELIGIBLE, payoutId: null },
          );
      }
      payout.status = PaymentStatus.VOIDED;
      payout.voidedAt = this.time.now();
      payout.voidedById = actor.userId;
      payout.voidReason = reason;
      await manager.getRepository(ReferralPayout).save(payout);
      await this.expenses.voidForPayout(
        manager,
        payout.expenseId,
        reason,
        actor,
      );
      await this.audit(manager, actor, AuditAction.REFERRAL_PAYOUT_VOIDED, id, {
        oldValues: { status: PaymentStatus.VALID },
        newValues: {
          status: payout.status,
          reason,
          expenseId: payout.expenseId,
          allocations: allocations.map((a) => ({
            commissionId: a.commissionId,
            amount: a.amount,
          })),
        },
      });
    });
    return this.findOne(id);
  }

  // Newest first.
  async list(referringDoctorId: string): Promise<PayoutDto[]> {
    if (
      !(await this.dataSource.manager.existsBy(ReferringDoctor, {
        id: referringDoctorId,
      }))
    ) {
      throw new NotFoundException('Referring doctor not found');
    }
    const payouts = await this.dataSource.getRepository(ReferralPayout).find({
      where: { referringDoctorId },
      relations: RELATIONS,
      order: { payoutDate: 'DESC', paidAt: 'DESC', id: 'DESC' },
    });
    return this.toDtos(payouts);
  }

  async forIds(ids: string[]): Promise<PayoutDto[]> {
    if (ids.length === 0) return [];
    const payouts = await this.dataSource.getRepository(ReferralPayout).find({
      where: { id: In(ids) },
      relations: RELATIONS,
      order: { payoutDate: 'DESC', paidAt: 'DESC', id: 'DESC' },
    });
    return this.toDtos(payouts);
  }

  private async findOne(id: string): Promise<PayoutDto> {
    const [dto] = await this.forIds([id]);
    if (!dto) throw new NotFoundException('Payout not found');
    return dto;
  }

  private async toDtos(payouts: ReferralPayout[]): Promise<PayoutDto[]> {
    if (payouts.length === 0) return [];
    const counts: { payout_id: string; count: string }[] =
      await this.dataSource.query(
        `SELECT payout_id, COUNT(*) AS count FROM referral_payout_allocations
          WHERE payout_id = ANY($1) GROUP BY payout_id`,
        [payouts.map((p) => p.id)],
      );
    const byPayout = new Map(counts.map((c) => [c.payout_id, Number(c.count)]));
    const toIso = (d: Date) => this.time.toIso(d);
    return payouts.map((p) => toPayout(p, byPayout.get(p.id) ?? 0, toIso));
  }

  private audit(
    manager: EntityManager,
    actor: Actor,
    action: AuditAction,
    id: string,
    values: Parameters<AuditService['logAction']>[4],
  ): Promise<void> {
    return this.auditService.logAction(
      actor,
      action,
      AuditEntityType.REFERRAL_PAYOUT,
      id,
      values,
      manager,
    );
  }
}
