import { MigrationInterface, QueryRunner } from 'typeorm';

export class ReferralsAcquisition1793996728640 implements MigrationInterface {
  name = 'ReferralsAcquisition1793996728640';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."acquisition_channel" AS ENUM('FACEBOOK', 'INSTAGRAM', 'OTHER_SOCIAL_MEDIA', 'GOOGLE', 'GOOGLE_ADS', 'ADVERTISEMENT', 'FRIENDS_FAMILY', 'EXISTING_PATIENT', 'WEBSITE', 'DOCTOR_REFERRAL', 'OTHER')`,
    );
    await queryRunner.query(`CREATE TABLE "patient_acquisition_sources" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "patient_id" uuid NOT NULL, "channel" "public"."acquisition_channel" NOT NULL, "details" character varying(255), "is_primary" boolean NOT NULL DEFAULT false, "recorded_by" uuid NOT NULL, "recorded_at" TIMESTAMP WITH TIME ZONE NOT NULL, "removed_at" TIMESTAMP WITH TIME ZONE, "removed_by" uuid, "removal_reason" character varying(255), CONSTRAINT "chk_patient_acquisition_sources_removed" CHECK (("removed_at" IS NULL AND "removed_by" IS NULL AND "removal_reason" IS NULL)
   OR ("removed_at" IS NOT NULL AND "removed_by" IS NOT NULL AND "removal_reason" IS NOT NULL AND NOT "is_primary")), CONSTRAINT "PK_3f8c672fc376dc2c6c3dcd93cbd" PRIMARY KEY ("id"))`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_patient_acquisition_sources_channel" ON "patient_acquisition_sources"  ("patient_id", "channel") WHERE "removed_at" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_patient_acquisition_sources_primary" ON "patient_acquisition_sources"  ("patient_id") WHERE "is_primary" AND "removed_at" IS NULL`,
    );
    await queryRunner.query(
      `CREATE TABLE "referring_doctors" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "name" character varying(120) NOT NULL, "phone" character varying(20), "specialty" character varying(120), "workplace" character varying(200), "notes" text, "is_active" boolean NOT NULL DEFAULT true, "created_by" uuid NOT NULL, CONSTRAINT "PK_967af1f709b7737f37da9cd8c42" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_referring_doctors_phone" ON "referring_doctors"  ("phone") WHERE "phone" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."patient_referral_status" AS ENUM('ACTIVE', 'ENDED')`,
    );
    await queryRunner.query(`CREATE TABLE "patient_referrals" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "patient_id" uuid NOT NULL, "referring_doctor_id" uuid NOT NULL, "status" "public"."patient_referral_status" NOT NULL, "assigned_by" uuid NOT NULL, "assigned_at" TIMESTAMP WITH TIME ZONE NOT NULL, "ended_at" TIMESTAMP WITH TIME ZONE, "ended_by" uuid, "end_reason" character varying(255), CONSTRAINT "chk_patient_referrals_ended" CHECK (("status" = 'ACTIVE' AND "ended_at" IS NULL AND "ended_by" IS NULL AND "end_reason" IS NULL)
   OR ("status" = 'ENDED' AND "ended_at" IS NOT NULL AND "ended_by" IS NOT NULL AND "end_reason" IS NOT NULL)), CONSTRAINT "PK_d59d0411ee65f505fd72cf6e5a2" PRIMARY KEY ("id"))`);
    await queryRunner.query(
      `CREATE INDEX "idx_patient_referrals_doctor" ON "patient_referrals"  ("referring_doctor_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_patient_referrals_patient" ON "patient_referrals"  ("patient_id") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_patient_referrals_active" ON "patient_referrals"  ("patient_id") WHERE "status" = 'ACTIVE'`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."referral_rate_type" AS ENUM('NONE', 'PERCENT', 'FIXED')`,
    );
    await queryRunner.query(`CREATE TABLE "referring_doctor_agreements" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "referring_doctor_id" uuid NOT NULL, "version" integer NOT NULL, "effective_from" date NOT NULL, "commission_type" "public"."referral_rate_type" NOT NULL, "commission_value" numeric(12,2), "discount_type" "public"."referral_rate_type" NOT NULL, "discount_value" numeric(12,2), "notes" character varying(255), "created_by" uuid NOT NULL, "recorded_at" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "uq_referring_doctor_agreements_version" UNIQUE ("referring_doctor_id", "version"), CONSTRAINT "chk_referring_doctor_agreements_discount" CHECK (("discount_type" = 'NONE' AND "discount_value" IS NULL)
   OR ("discount_type" = 'PERCENT' AND "discount_value" > 0 AND "discount_value" <= 100)
   OR ("discount_type" = 'FIXED' AND "discount_value" > 0)), CONSTRAINT "chk_referring_doctor_agreements_commission" CHECK (("commission_type" = 'NONE' AND "commission_value" IS NULL)
   OR ("commission_type" = 'PERCENT' AND "commission_value" > 0 AND "commission_value" <= 100)
   OR ("commission_type" = 'FIXED' AND "commission_value" > 0)), CONSTRAINT "chk_referring_doctor_agreements_version" CHECK ("version" >= 1), CONSTRAINT "PK_f588634b5a59cf47726531a6bb8" PRIMARY KEY ("id"))`);
    await queryRunner.query(
      `CREATE TYPE "public"."referral_applicability" AS ENUM('FIRST_SESSION', 'ALL_SESSIONS', 'SESSION_COUNT', 'DATE_RANGE')`,
    );
    await queryRunner.query(`CREATE TABLE "patient_referral_terms" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "patient_referral_id" uuid NOT NULL, "version" integer NOT NULL, "doctor_agreement_id" uuid NOT NULL, "commission_type" "public"."referral_rate_type" NOT NULL, "commission_value" numeric(12,2), "discount_type" "public"."referral_rate_type" NOT NULL, "discount_value" numeric(12,2), "applicability" "public"."referral_applicability" NOT NULL, "max_sessions" integer, "valid_from" date, "valid_to" date, "is_override" boolean NOT NULL, "override_reason" character varying(255), "created_by" uuid NOT NULL, "recorded_at" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "uq_patient_referral_terms_version" UNIQUE ("patient_referral_id", "version"), CONSTRAINT "chk_patient_referral_terms_override" CHECK (NOT "is_override" OR length(trim("override_reason")) >= 3), CONSTRAINT "chk_patient_referral_terms_applicability" CHECK (("applicability" IN ('FIRST_SESSION', 'ALL_SESSIONS') AND "max_sessions" IS NULL AND "valid_from" IS NULL AND "valid_to" IS NULL)
   OR ("applicability" = 'SESSION_COUNT' AND "max_sessions" >= 1 AND "valid_from" IS NULL AND "valid_to" IS NULL)
   OR ("applicability" = 'DATE_RANGE' AND "max_sessions" IS NULL AND "valid_from" IS NOT NULL AND "valid_to" IS NOT NULL AND "valid_from" <= "valid_to")), CONSTRAINT "chk_patient_referral_terms_discount" CHECK (("discount_type" = 'NONE' AND "discount_value" IS NULL)
   OR ("discount_type" = 'PERCENT' AND "discount_value" > 0 AND "discount_value" <= 100)
   OR ("discount_type" = 'FIXED' AND "discount_value" > 0)), CONSTRAINT "chk_patient_referral_terms_commission" CHECK (("commission_type" = 'NONE' AND "commission_value" IS NULL)
   OR ("commission_type" = 'PERCENT' AND "commission_value" > 0 AND "commission_value" <= 100)
   OR ("commission_type" = 'FIXED' AND "commission_value" > 0)), CONSTRAINT "chk_patient_referral_terms_version" CHECK ("version" >= 1), CONSTRAINT "PK_e642fdba8ed857d5715efd48d0b" PRIMARY KEY ("id"))`);
    await queryRunner.query(`CREATE TABLE "referral_payouts" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "referring_doctor_id" uuid NOT NULL, "amount" numeric(12,2) NOT NULL, "method" "public"."payment_method" NOT NULL, "reference" character varying(100), "notes" character varying(255), "status" "public"."payment_status" NOT NULL DEFAULT 'VALID', "paid_by" uuid NOT NULL, "paid_at" TIMESTAMP WITH TIME ZONE NOT NULL, "voided_at" TIMESTAMP WITH TIME ZONE, "voided_by" uuid, "void_reason" character varying(255), CONSTRAINT "chk_referral_payouts_voided" CHECK (("status" = 'VALID' AND "voided_at" IS NULL AND "voided_by" IS NULL AND "void_reason" IS NULL)
   OR ("status" = 'VOIDED' AND "voided_at" IS NOT NULL AND "voided_by" IS NOT NULL AND "void_reason" IS NOT NULL)), CONSTRAINT "chk_referral_payouts_amount_positive" CHECK ("amount" > 0), CONSTRAINT "PK_9b4ba98b66b035d28d0c83f47e4" PRIMARY KEY ("id"))`);
    await queryRunner.query(
      `CREATE INDEX "idx_referral_payouts_doctor_paid" ON "referral_payouts"  ("referring_doctor_id", "paid_at") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."referral_commission_kind" AS ENUM('EARNED', 'REFUND_REVERSAL', 'VOID_REVERSAL', 'REFUND_VOIDED', 'ADJUSTMENT')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."referral_commission_status" AS ENUM('PENDING', 'ELIGIBLE', 'PAID')`,
    );
    await queryRunner.query(`CREATE TABLE "referral_commissions" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "referring_doctor_id" uuid NOT NULL, "patient_id" uuid, "patient_referral_id" uuid, "referral_terms_id" uuid, "invoice_id" uuid, "visit_id" uuid, "payment_id" uuid, "source_payment_id" uuid, "kind" "public"."referral_commission_kind" NOT NULL, "commission_type" "public"."referral_rate_type", "rate" numeric(12,2), "base_amount" numeric(12,2), "amount" numeric(12,2) NOT NULL, "status" "public"."referral_commission_status" NOT NULL, "eligible_at" TIMESTAMP WITH TIME ZONE, "payout_id" uuid, "reason" character varying(255), "recorded_by" uuid NOT NULL, "recorded_at" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "chk_referral_commissions_status" CHECK (("status" = 'PENDING' AND "eligible_at" IS NULL AND "payout_id" IS NULL)
   OR ("status" = 'ELIGIBLE' AND "eligible_at" IS NOT NULL AND "payout_id" IS NULL)
   OR ("status" = 'PAID' AND "eligible_at" IS NOT NULL AND "payout_id" IS NOT NULL)), CONSTRAINT "chk_referral_commissions_sign" CHECK (("kind" IN ('EARNED', 'REFUND_VOIDED') AND "amount" > 0)
   OR ("kind" IN ('REFUND_REVERSAL', 'VOID_REVERSAL') AND "amount" < 0)
   OR ("kind" = 'ADJUSTMENT' AND "amount" <> 0)), CONSTRAINT "chk_referral_commissions_shape" CHECK (("kind" = 'ADJUSTMENT' AND length(trim("reason")) >= 3 AND "referral_terms_id" IS NULL AND "invoice_id" IS NULL
     AND "payment_id" IS NULL AND "source_payment_id" IS NULL AND "commission_type" IS NULL AND "rate" IS NULL AND "base_amount" IS NULL)
   OR ("kind" <> 'ADJUSTMENT' AND "patient_id" IS NOT NULL AND "patient_referral_id" IS NOT NULL AND "referral_terms_id" IS NOT NULL
     AND "invoice_id" IS NOT NULL AND "payment_id" IS NOT NULL AND "source_payment_id" IS NOT NULL
     AND "commission_type" IN ('PERCENT', 'FIXED') AND "rate" > 0 AND "base_amount" > 0)), CONSTRAINT "PK_ea91978c3fd0b7509e9456daecf" PRIMARY KEY ("id"))`);
    await queryRunner.query(
      `CREATE INDEX "idx_referral_commissions_payout" ON "referral_commissions"  ("payout_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_referral_commissions_patient" ON "referral_commissions"  ("patient_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_referral_commissions_invoice" ON "referral_commissions"  ("invoice_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_referral_commissions_doctor_status" ON "referral_commissions"  ("referring_doctor_id", "status") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_referral_commissions_event" ON "referral_commissions"  ("source_payment_id", "kind") WHERE "source_payment_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "appointments" ADD "utm_source" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "appointments" ADD "utm_medium" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "appointments" ADD "utm_campaign" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "appointments" ADD "utm_content" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "appointments" ADD "utm_term" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoices" ADD "referral_terms_id" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoice_discounts" ADD "referral_terms_id" uuid`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_invoices_referral_terms" ON "invoices"  ("referral_terms_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "patient_acquisition_sources" ADD CONSTRAINT "fk_patient_acquisition_sources_patient" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "patient_acquisition_sources" ADD CONSTRAINT "fk_patient_acquisition_sources_recorded_by" FOREIGN KEY ("recorded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "patient_acquisition_sources" ADD CONSTRAINT "fk_patient_acquisition_sources_removed_by" FOREIGN KEY ("removed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "referring_doctors" ADD CONSTRAINT "fk_referring_doctors_created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "patient_referrals" ADD CONSTRAINT "fk_patient_referrals_patient" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "patient_referrals" ADD CONSTRAINT "fk_patient_referrals_doctor" FOREIGN KEY ("referring_doctor_id") REFERENCES "referring_doctors"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "patient_referrals" ADD CONSTRAINT "fk_patient_referrals_assigned_by" FOREIGN KEY ("assigned_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "patient_referrals" ADD CONSTRAINT "fk_patient_referrals_ended_by" FOREIGN KEY ("ended_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "referring_doctor_agreements" ADD CONSTRAINT "fk_referring_doctor_agreements_doctor" FOREIGN KEY ("referring_doctor_id") REFERENCES "referring_doctors"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "referring_doctor_agreements" ADD CONSTRAINT "fk_referring_doctor_agreements_created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "patient_referral_terms" ADD CONSTRAINT "fk_patient_referral_terms_referral" FOREIGN KEY ("patient_referral_id") REFERENCES "patient_referrals"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "patient_referral_terms" ADD CONSTRAINT "fk_patient_referral_terms_agreement" FOREIGN KEY ("doctor_agreement_id") REFERENCES "referring_doctor_agreements"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "patient_referral_terms" ADD CONSTRAINT "fk_patient_referral_terms_created_by" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoices" ADD CONSTRAINT "fk_invoices_referral_terms" FOREIGN KEY ("referral_terms_id") REFERENCES "patient_referral_terms"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoice_discounts" ADD CONSTRAINT "fk_invoice_discounts_referral_terms" FOREIGN KEY ("referral_terms_id") REFERENCES "patient_referral_terms"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "referral_payouts" ADD CONSTRAINT "fk_referral_payouts_doctor" FOREIGN KEY ("referring_doctor_id") REFERENCES "referring_doctors"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "referral_payouts" ADD CONSTRAINT "fk_referral_payouts_paid_by" FOREIGN KEY ("paid_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "referral_payouts" ADD CONSTRAINT "fk_referral_payouts_voided_by" FOREIGN KEY ("voided_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "referral_commissions" ADD CONSTRAINT "fk_referral_commissions_doctor" FOREIGN KEY ("referring_doctor_id") REFERENCES "referring_doctors"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "referral_commissions" ADD CONSTRAINT "fk_referral_commissions_patient" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "referral_commissions" ADD CONSTRAINT "fk_referral_commissions_referral" FOREIGN KEY ("patient_referral_id") REFERENCES "patient_referrals"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "referral_commissions" ADD CONSTRAINT "fk_referral_commissions_terms" FOREIGN KEY ("referral_terms_id") REFERENCES "patient_referral_terms"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "referral_commissions" ADD CONSTRAINT "fk_referral_commissions_invoice" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "referral_commissions" ADD CONSTRAINT "fk_referral_commissions_visit" FOREIGN KEY ("visit_id") REFERENCES "visits"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "referral_commissions" ADD CONSTRAINT "fk_referral_commissions_payment" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "referral_commissions" ADD CONSTRAINT "fk_referral_commissions_source_payment" FOREIGN KEY ("source_payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "referral_commissions" ADD CONSTRAINT "fk_referral_commissions_payout" FOREIGN KEY ("payout_id") REFERENCES "referral_payouts"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "referral_commissions" ADD CONSTRAINT "fk_referral_commissions_recorded_by" FOREIGN KEY ("recorded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "referral_commissions" DROP CONSTRAINT "fk_referral_commissions_recorded_by"`,
    );
    await queryRunner.query(
      `ALTER TABLE "referral_commissions" DROP CONSTRAINT "fk_referral_commissions_payout"`,
    );
    await queryRunner.query(
      `ALTER TABLE "referral_commissions" DROP CONSTRAINT "fk_referral_commissions_source_payment"`,
    );
    await queryRunner.query(
      `ALTER TABLE "referral_commissions" DROP CONSTRAINT "fk_referral_commissions_payment"`,
    );
    await queryRunner.query(
      `ALTER TABLE "referral_commissions" DROP CONSTRAINT "fk_referral_commissions_visit"`,
    );
    await queryRunner.query(
      `ALTER TABLE "referral_commissions" DROP CONSTRAINT "fk_referral_commissions_invoice"`,
    );
    await queryRunner.query(
      `ALTER TABLE "referral_commissions" DROP CONSTRAINT "fk_referral_commissions_terms"`,
    );
    await queryRunner.query(
      `ALTER TABLE "referral_commissions" DROP CONSTRAINT "fk_referral_commissions_referral"`,
    );
    await queryRunner.query(
      `ALTER TABLE "referral_commissions" DROP CONSTRAINT "fk_referral_commissions_patient"`,
    );
    await queryRunner.query(
      `ALTER TABLE "referral_commissions" DROP CONSTRAINT "fk_referral_commissions_doctor"`,
    );
    await queryRunner.query(
      `ALTER TABLE "referral_payouts" DROP CONSTRAINT "fk_referral_payouts_voided_by"`,
    );
    await queryRunner.query(
      `ALTER TABLE "referral_payouts" DROP CONSTRAINT "fk_referral_payouts_paid_by"`,
    );
    await queryRunner.query(
      `ALTER TABLE "referral_payouts" DROP CONSTRAINT "fk_referral_payouts_doctor"`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoice_discounts" DROP CONSTRAINT "fk_invoice_discounts_referral_terms"`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoices" DROP CONSTRAINT "fk_invoices_referral_terms"`,
    );
    await queryRunner.query(
      `ALTER TABLE "patient_referral_terms" DROP CONSTRAINT "fk_patient_referral_terms_created_by"`,
    );
    await queryRunner.query(
      `ALTER TABLE "patient_referral_terms" DROP CONSTRAINT "fk_patient_referral_terms_agreement"`,
    );
    await queryRunner.query(
      `ALTER TABLE "patient_referral_terms" DROP CONSTRAINT "fk_patient_referral_terms_referral"`,
    );
    await queryRunner.query(
      `ALTER TABLE "referring_doctor_agreements" DROP CONSTRAINT "fk_referring_doctor_agreements_created_by"`,
    );
    await queryRunner.query(
      `ALTER TABLE "referring_doctor_agreements" DROP CONSTRAINT "fk_referring_doctor_agreements_doctor"`,
    );
    await queryRunner.query(
      `ALTER TABLE "patient_referrals" DROP CONSTRAINT "fk_patient_referrals_ended_by"`,
    );
    await queryRunner.query(
      `ALTER TABLE "patient_referrals" DROP CONSTRAINT "fk_patient_referrals_assigned_by"`,
    );
    await queryRunner.query(
      `ALTER TABLE "patient_referrals" DROP CONSTRAINT "fk_patient_referrals_doctor"`,
    );
    await queryRunner.query(
      `ALTER TABLE "patient_referrals" DROP CONSTRAINT "fk_patient_referrals_patient"`,
    );
    await queryRunner.query(
      `ALTER TABLE "referring_doctors" DROP CONSTRAINT "fk_referring_doctors_created_by"`,
    );
    await queryRunner.query(
      `ALTER TABLE "patient_acquisition_sources" DROP CONSTRAINT "fk_patient_acquisition_sources_removed_by"`,
    );
    await queryRunner.query(
      `ALTER TABLE "patient_acquisition_sources" DROP CONSTRAINT "fk_patient_acquisition_sources_recorded_by"`,
    );
    await queryRunner.query(
      `ALTER TABLE "patient_acquisition_sources" DROP CONSTRAINT "fk_patient_acquisition_sources_patient"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_invoices_referral_terms"`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoice_discounts" DROP COLUMN "referral_terms_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoices" DROP COLUMN "referral_terms_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "appointments" DROP COLUMN "utm_term"`,
    );
    await queryRunner.query(
      `ALTER TABLE "appointments" DROP COLUMN "utm_content"`,
    );
    await queryRunner.query(
      `ALTER TABLE "appointments" DROP COLUMN "utm_campaign"`,
    );
    await queryRunner.query(
      `ALTER TABLE "appointments" DROP COLUMN "utm_medium"`,
    );
    await queryRunner.query(
      `ALTER TABLE "appointments" DROP COLUMN "utm_source"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."uq_referral_commissions_event"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_referral_commissions_doctor_status"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_referral_commissions_invoice"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_referral_commissions_patient"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_referral_commissions_payout"`,
    );
    await queryRunner.query(`DROP TABLE "referral_commissions"`);
    await queryRunner.query(`DROP TYPE "public"."referral_commission_status"`);
    await queryRunner.query(`DROP TYPE "public"."referral_commission_kind"`);
    await queryRunner.query(
      `DROP INDEX "public"."idx_referral_payouts_doctor_paid"`,
    );
    await queryRunner.query(`DROP TABLE "referral_payouts"`);
    await queryRunner.query(`DROP TABLE "patient_referral_terms"`);
    await queryRunner.query(`DROP TYPE "public"."referral_applicability"`);
    await queryRunner.query(`DROP TABLE "referring_doctor_agreements"`);
    await queryRunner.query(`DROP TYPE "public"."referral_rate_type"`);
    await queryRunner.query(
      `DROP INDEX "public"."uq_patient_referrals_active"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_patient_referrals_patient"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_patient_referrals_doctor"`,
    );
    await queryRunner.query(`DROP TABLE "patient_referrals"`);
    await queryRunner.query(`DROP TYPE "public"."patient_referral_status"`);
    await queryRunner.query(`DROP INDEX "public"."uq_referring_doctors_phone"`);
    await queryRunner.query(`DROP TABLE "referring_doctors"`);
    await queryRunner.query(
      `DROP INDEX "public"."uq_patient_acquisition_sources_primary"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."uq_patient_acquisition_sources_channel"`,
    );
    await queryRunner.query(`DROP TABLE "patient_acquisition_sources"`);
    await queryRunner.query(`DROP TYPE "public"."acquisition_channel"`);
  }
}
