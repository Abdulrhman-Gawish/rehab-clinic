import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsLocalDate } from '../../../common/decorators/date-time.decorators.js';
import {
  PaginationMetaDto,
  PaginationQueryDto,
} from '../../../common/dto/pagination.dto.js';

const MONEY = (example: string, description?: string) => ({
  example,
  description: description ?? 'Decimal string with 2 decimals',
});

// ---------- Inputs ----------

export class AsOfQueryDto {
  @ApiProperty({
    example: '2026-11-14',
    description: 'Balances at the end of this clinic local date',
  })
  @IsLocalDate()
  asOf: string;
}

export class PatientsOweQueryDto extends PaginationQueryDto {
  @ApiProperty({
    example: '2026-11-14',
    description: 'Balances at the end of this clinic local date',
  })
  @IsLocalDate()
  asOf: string;
}

// ---------- Flows (daily summary, money flow report) ----------

/**
 * What patients owe on their invoices, from the start of the first day to
 * the end of the last: closing = opening + invoiced + adjustments -
 * cancelled - payments + refunds. Each event counts on the instant it
 * happened, and each balance uses the invoice totals in effect then (a
 * later discount never changes an earlier day). Voided payments never count.
 */
export class PatientsOweFlowDto {
  @ApiProperty(MONEY('2400.00', 'Owed at the start of the first day'))
  opening: string;

  @ApiProperty(
    MONEY(
      '1500.00',
      'Invoices issued in the period, at their total when issued (cancelled later or not)',
    ),
  )
  invoiced: string;

  @ApiProperty(
    MONEY(
      '-80.00',
      'Changes of invoice totals in the period, after their issue: discounts applied, replaced or removed, item edits (negative when they lowered what is owed)',
    ),
  )
  adjustments: string;

  @ApiProperty(
    MONEY('100.00', 'Invoices cancelled in the period, at their total then'),
  )
  cancelled: string;

  @ApiProperty(MONEY('1200.00', 'Valid payments received in the period'))
  payments: string;

  @ApiProperty(MONEY('50.00', 'Valid refunds made in the period'))
  refunds: string;

  @ApiProperty(MONEY('2650.00', 'Owed at the end of the last day'))
  closing: string;

  @ApiProperty({
    example: 9,
    description: 'Invoices with a balance at the end of the last day',
  })
  unpaidInvoices: number;
}

/** What the clinic owes its doctors at one moment. */
export class ClinicOwesTotalsDto {
  @ApiProperty(MONEY('5300.00', 'doctorSalaries + referralCommissions'))
  owed: string;

  @ApiProperty(
    MONEY(
      '4800.00',
      'Earned by the clinic’s doctors and not paid: fixed salaries of months that ended, session commissions',
    ),
  )
  doctorSalaries: string;

  @ApiProperty(
    MONEY('500.00', 'Owed to referring doctors and not paid out yet'),
  )
  referralCommissions: string;

  @ApiProperty(
    MONEY(
      '1000.00',
      'Paid ahead of what was earned (salary advances, referral payouts above what is owed); never subtracted from owed',
    ),
  )
  advances: string;

  @ApiProperty(
    MONEY(
      '60.00',
      'Referral commissions on money received for sessions not attended yet: not owed yet',
    ),
  )
  pendingCommissions: string;
}

/**
 * What the clinic owes, from the start of the first day to the end of the
 * last: closing.owed = opening.owed + salariesEarned + salaryAdjustments +
 * commissionsEarned - salaryPayments - commissionPayouts + advancesChange.
 */
export class ClinicOwesFlowDto {
  @ApiProperty({ type: ClinicOwesTotalsDto })
  opening: ClinicOwesTotalsDto;

  @ApiProperty(
    MONEY(
      '6000.00',
      'Fixed salaries falling due in the period (on their month’s last day) + commissions of the sessions attended in it',
    ),
  )
  salariesEarned: string;

  @ApiProperty(
    MONEY(
      '-5.00',
      'Commission changes of sessions attended before the period whose value changed in it (e.g. a later discount on their invoice)',
    ),
  )
  salaryAdjustments: string;

  @ApiProperty(
    MONEY(
      '450.00',
      'Referral commissions that became owed in the period (net of reversals and adjustments)',
    ),
  )
  commissionsEarned: string;

  @ApiProperty(
    MONEY('4000.00', 'Valid salary payments dated in the period (expenses)'),
  )
  salaryPayments: string;

  @ApiProperty(
    MONEY('300.00', 'Valid referral payouts dated in the period (expenses)'),
  )
  commissionPayouts: string;

  @ApiProperty(
    MONEY(
      '200.00',
      'closing.advances - opening.advances: a payment ahead of earnings does not lower what is owed',
    ),
  )
  advancesChange: string;

  @ApiProperty({ type: ClinicOwesTotalsDto })
  closing: ClinicOwesTotalsDto;
}

export class OutstandingFlowDto {
  @ApiProperty({ type: PatientsOweFlowDto })
  patientsOwe: PatientsOweFlowDto;

  @ApiPropertyOptional({
    type: ClinicOwesFlowDto,
    nullable: true,
    description: 'OWNER only (null for a receptionist)',
  })
  clinicOwes: ClinicOwesFlowDto | null;
}

// ---------- Breakdowns (reports) ----------

export class OwedPartyRefDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'Dr. Mona Adel' })
  name: string;
}

export class SalaryBalanceRowDto {
  @ApiProperty({ type: OwedPartyRefDto })
  doctor: OwedPartyRefDto;

  @ApiProperty({ example: '2026-10' })
  month: string;

  @ApiProperty(MONEY('3000.00', 'Counted once the month’s last day is reached'))
  fixedSalary: string;

  @ApiProperty({
    example: true,
    description: 'The month ended by then, so its fixed salary is owed',
  })
  fixedDue: boolean;

  @ApiProperty({ example: 12, description: 'Sessions attended by then' })
  sessionCount: number;

  @ApiProperty(MONEY('900.00'))
  commissions: string;

  @ApiProperty(MONEY('3900.00', 'fixedSalary + commissions'))
  earned: string;

  @ApiProperty(MONEY('3000.00', 'Valid payments for the month dated by then'))
  paid: string;

  @ApiProperty(MONEY('900.00', 'earned - paid: > 0 owed, < 0 paid in advance'))
  balance: string;
}

export class ReferralBalanceRowDto {
  @ApiProperty({ type: OwedPartyRefDto })
  referringDoctor: OwedPartyRefDto;

  @ApiProperty(
    MONEY(
      '900.00',
      'Commissions owed by then: earned - reversed + adjustments',
    ),
  )
  earned: string;

  @ApiProperty(MONEY('550.00', 'Valid payouts dated by then'))
  paid: string;

  @ApiProperty(
    MONEY('350.00', 'earned - paid: > 0 owed, < 0 paid out above it'),
  )
  balance: string;

  @ApiProperty(MONEY('30.00', 'Not owed yet (session not attended)'))
  pending: string;
}

export class SalaryBalancesDto {
  @ApiProperty(MONEY('4800.00'))
  owed: string;

  @ApiProperty(MONEY('500.00'))
  advances: string;

  @ApiProperty({
    type: [SalaryBalanceRowDto],
    description: 'Doctor-months with a balance, by doctor then month',
  })
  rows: SalaryBalanceRowDto[];
}

export class ReferralBalancesDto {
  @ApiProperty(MONEY('500.00'))
  owed: string;

  @ApiProperty(MONEY('0.00'))
  advances: string;

  @ApiProperty(MONEY('60.00'))
  pending: string;

  @ApiProperty({
    type: [ReferralBalanceRowDto],
    description: 'Referring doctors with a balance or pending commission',
  })
  rows: ReferralBalanceRowDto[];
}

export class ClinicOwesReportDto {
  @ApiProperty({ example: '2026-11-14' })
  asOf: string;

  @ApiProperty(
    MONEY('5300.00', 'doctorSalaries.owed + referralCommissions.owed'),
  )
  owed: string;

  @ApiProperty(MONEY('500.00'))
  advances: string;

  @ApiProperty({ type: SalaryBalancesDto })
  doctorSalaries: SalaryBalancesDto;

  @ApiProperty({ type: ReferralBalancesDto })
  referralCommissions: ReferralBalancesDto;
}

export class PatientRefDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'Ahmed Hassan' })
  name: string;

  @ApiProperty({ example: '+201012345678' })
  phone: string;
}

export class UnpaidInvoiceDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'INV-2026-000123' })
  invoiceNumber: string;

  @ApiProperty({ example: '2026-11-03T10:15:00+02:00' })
  issuedAt: string;

  @ApiProperty(MONEY('300.00'))
  total: string;

  @ApiProperty(MONEY('100.00', 'Valid payments - refunds received by then'))
  paid: string;

  @ApiProperty(MONEY('200.00', 'total - paid'))
  balance: string;
}

export class PatientOwesRowDto {
  @ApiProperty({ type: PatientRefDto })
  patient: PatientRefDto;

  @ApiProperty(MONEY('450.00'))
  balance: string;

  @ApiProperty({
    example: '2026-11-03',
    description: 'Clinic local date of the oldest unpaid invoice',
  })
  oldestUnpaidInvoiceDate: string;

  @ApiProperty({
    type: [UnpaidInvoiceDto],
    description: 'Its invoices with a balance, oldest first',
  })
  invoices: UnpaidInvoiceDto[];
}

export class PatientsOweListDto {
  @ApiProperty({ type: [PatientOwesRowDto] })
  items: PatientOwesRowDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta: PaginationMetaDto;

  @ApiProperty({ example: '2026-11-14' })
  asOf: string;

  @ApiProperty(MONEY('2650.00', 'Every balance at the end of asOf (all pages)'))
  totalBalance: string;

  @ApiProperty({ example: 9, description: 'Invoices with a balance' })
  unpaidInvoices: number;
}
