import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  Unique,
  type Relation,
} from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity.js';
import { ReferralCommission } from './referral-commission.entity.js';
import { ReferralPayout } from './referral-payout.entity.js';

/**
 * The part of a commission row a payout settled (signed like the row). A
 * row can be settled by several payouts (partial payouts). Never changed:
 * an allocation counts while its payout is VALID, so voiding the payout
 * makes the money owed again and keeps the history.
 */
@Entity('referral_payout_allocations')
@Unique('uq_referral_payout_allocations_payout_commission', [
  'payoutId',
  'commissionId',
])
@Index('idx_referral_payout_allocations_commission', ['commissionId'])
@Check('chk_referral_payout_allocations_amount', '"amount" <> 0')
export class ReferralPayoutAllocation extends BaseEntity {
  @Column({ type: 'uuid' })
  payoutId: string;

  @ManyToOne(() => ReferralPayout, { onDelete: 'RESTRICT' })
  @JoinColumn({
    foreignKeyConstraintName: 'fk_referral_payout_allocations_payout',
  })
  payout?: Relation<ReferralPayout>;

  @Column({ type: 'uuid' })
  commissionId: string;

  @ManyToOne(() => ReferralCommission, { onDelete: 'RESTRICT' })
  @JoinColumn({
    foreignKeyConstraintName: 'fk_referral_payout_allocations_commission',
  })
  commission?: Relation<ReferralCommission>;

  @Column({ type: 'numeric', precision: 12, scale: 2 })
  amount: string;
}
