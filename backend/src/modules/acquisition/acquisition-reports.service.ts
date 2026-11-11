import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ClinicTimeService } from '../../common/time/clinic-time.service.js';
import { toMoney } from '../../common/utils/money.util.js';
import {
  AcquisitionCategory,
  AcquisitionChannel,
  CHANNEL_CATEGORY,
} from './acquisition.enums.js';
import type {
  AcquisitionReportDto,
  AcquisitionReportQueryDto,
  CampaignReportDto,
  CampaignReportQueryDto,
} from './dto/acquisition.dto.js';

interface ChannelSqlRow {
  channel: AcquisitionChannel;
  patients: string;
  mentions: string;
  attended: string;
  paying: string;
  collected: string;
}

interface CampaignSqlRow {
  source: string | null;
  medium: string | null;
  campaign: string | null;
  bookings: string;
  attended: string;
  patients: string;
  new_patients: string;
  paying: string;
  collected: string;
}

// Money kept from a patient: valid payments minus valid refunds.
const NET = `SUM(CASE WHEN pm.type = 'PAYMENT' THEN pm.amount ELSE -pm.amount END)`;

const TAGGED = `(a.utm_source IS NOT NULL OR a.utm_medium IS NOT NULL OR a.utm_campaign IS NOT NULL
  OR a.utm_content IS NOT NULL OR a.utm_term IS NOT NULL)`;

/**
 * Marketing reports (OWNER). Two separate inputs, never mixed:
 * - acquisition sources reception recorded (by patient creation date);
 * - utm_* tags of online bookings (by appointment start, like the other
 *   appointment reports: RESCHEDULED excluded, the new one counts).
 * A booking is not a patient: attended and paying are counted apart.
 */
@Injectable()
export class AcquisitionReportsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly time: ClinicTimeService,
  ) {}

  async acquisition(
    query: AcquisitionReportQueryDto,
  ): Promise<AcquisitionReportDto> {
    const { start, end } = this.range(query.from, query.to);
    const channelFilter = query.channel ? 'AND s.channel = $3' : '';
    const params: unknown[] = query.channel
      ? [start, end, query.channel]
      : [start, end];

    const rows: ChannelSqlRow[] = await this.dataSource.query(
      `WITH cohort AS (
         SELECT id FROM patients WHERE created_at >= $1 AND created_at < $2
       ), attended AS (
         SELECT DISTINCT v.patient_id FROM visits v JOIN cohort c ON c.id = v.patient_id
          WHERE v.status = 'ACTIVE'
       ), paid AS (
         SELECT pm.patient_id, ${NET} AS net FROM payments pm JOIN cohort c ON c.id = pm.patient_id
          WHERE pm.status = 'VALID' GROUP BY pm.patient_id
       )
       SELECT s.channel,
              COUNT(*) FILTER (WHERE s.is_primary) AS patients,
              COUNT(*) AS mentions,
              COUNT(*) FILTER (WHERE s.is_primary AND a.patient_id IS NOT NULL) AS attended,
              COUNT(*) FILTER (WHERE s.is_primary AND pd.net > 0) AS paying,
              COALESCE(SUM(pd.net) FILTER (WHERE s.is_primary), 0) AS collected
         FROM patient_acquisition_sources s
         JOIN cohort c ON c.id = s.patient_id
         LEFT JOIN attended a ON a.patient_id = s.patient_id
         LEFT JOIN paid pd ON pd.patient_id = s.patient_id
        WHERE s.removed_at IS NULL ${channelFilter}
        GROUP BY s.channel
        ORDER BY patients DESC, mentions DESC, s.channel`,
      params,
    );

    const [totals]: { new_patients: string; without_source: string }[] =
      await this.dataSource.query(
        `SELECT COUNT(*) AS new_patients,
                COUNT(*) FILTER (WHERE NOT EXISTS (
                  SELECT 1 FROM patient_acquisition_sources s
                   WHERE s.patient_id = p.id AND s.removed_at IS NULL)) AS without_source
           FROM patients p WHERE p.created_at >= $1 AND p.created_at < $2`,
        [start, end],
      );

    const monthChannelFilter = query.channel ? 'AND s.channel = $4' : '';
    const months: {
      month: string;
      channel: AcquisitionChannel | null;
      patients: string;
    }[] = await this.dataSource.query(
      `SELECT to_char(p.created_at AT TIME ZONE $3, 'YYYY-MM') AS month, s.channel, COUNT(*) AS patients
           FROM patients p
           LEFT JOIN patient_acquisition_sources s
             ON s.patient_id = p.id AND s.is_primary AND s.removed_at IS NULL
          WHERE p.created_at >= $1 AND p.created_at < $2 ${monthChannelFilter}
          GROUP BY 1, 2
          ORDER BY 1, patients DESC, s.channel NULLS LAST`,
      query.channel
        ? [start, end, this.time.zone, query.channel]
        : [start, end, this.time.zone],
    );

    const channels = rows.map((r) => ({
      channel: r.channel,
      category: CHANNEL_CATEGORY[r.channel],
      patients: Number(r.patients),
      mentions: Number(r.mentions),
      attendedPatients: Number(r.attended),
      payingPatients: Number(r.paying),
      collected: toMoney(r.collected),
    }));
    const byCategory = new Map<AcquisitionCategory, number>();
    for (const row of channels) {
      byCategory.set(
        row.category,
        (byCategory.get(row.category) ?? 0) + row.patients,
      );
    }
    return {
      from: query.from,
      to: query.to,
      newPatients: Number(totals.new_patients),
      withoutSource: Number(totals.without_source),
      channels,
      categories: [...byCategory.entries()]
        .map(([category, patients]) => ({ category, patients }))
        .sort((a, b) => b.patients - a.patients),
      byMonth: months.map((m) => ({
        month: m.month,
        channel: m.channel,
        patients: Number(m.patients),
      })),
    };
  }

  async campaigns(query: CampaignReportQueryDto): Promise<CampaignReportDto> {
    const { start, end } = this.range(query.from, query.to);
    // `first`: the patient's first appointment ever. The patient is "new" for
    // the campaign when the online booking that created them carried its tags
    // (a reschedule copies the tags, so it doesn't matter which one is first).
    const rows: CampaignSqlRow[] = await this.dataSource.query(
      `SELECT a.utm_source AS source, a.utm_medium AS medium, a.utm_campaign AS campaign,
              COUNT(*) AS bookings,
              COUNT(*) FILTER (WHERE a.status = 'ATTENDED') AS attended,
              COUNT(DISTINCT a.patient_id) AS patients,
              COUNT(DISTINCT a.patient_id) FILTER (
                WHERE p.created_source = 'ONLINE'
                  AND first.utm_source IS NOT DISTINCT FROM a.utm_source
                  AND first.utm_medium IS NOT DISTINCT FROM a.utm_medium
                  AND first.utm_campaign IS NOT DISTINCT FROM a.utm_campaign) AS new_patients,
              COUNT(DISTINCT a.patient_id) FILTER (WHERE paid.net > 0) AS paying,
              COALESCE(SUM(paid.net), 0) AS collected
         FROM appointments a
         JOIN patients p ON p.id = a.patient_id
         CROSS JOIN LATERAL (
           SELECT f.utm_source, f.utm_medium, f.utm_campaign FROM appointments f
            WHERE f.patient_id = a.patient_id ORDER BY f.created_at, f.id LIMIT 1) first
         LEFT JOIN visits v ON v.appointment_id = a.id AND v.status = 'ACTIVE'
         LEFT JOIN invoices i ON i.visit_id = v.id AND i.status <> 'CANCELLED'
         LEFT JOIN LATERAL (
           SELECT ${NET} AS net FROM payments pm
            WHERE pm.invoice_id = i.id AND pm.status = 'VALID') paid ON true
        WHERE a.status <> 'RESCHEDULED' AND a.start_at >= $1 AND a.start_at < $2 AND ${TAGGED}
        GROUP BY a.utm_source, a.utm_medium, a.utm_campaign
        ORDER BY bookings DESC, a.utm_source NULLS LAST, a.utm_campaign NULLS LAST`,
      [start, end],
    );
    return {
      from: query.from,
      to: query.to,
      rows: rows.map((r) => ({
        source: r.source,
        medium: r.medium,
        campaign: r.campaign,
        bookings: Number(r.bookings),
        attended: Number(r.attended),
        patients: Number(r.patients),
        newPatients: Number(r.new_patients),
        payingPatients: Number(r.paying),
        collected: toMoney(r.collected),
      })),
    };
  }

  private range(from: string, to: string): { start: Date; end: Date } {
    if (from > to) {
      throw new BadRequestException('`from` must be on or before `to`');
    }
    const { start, end } = this.time.dateRange(from, to);
    return { start: start!, end: end! };
  }
}
