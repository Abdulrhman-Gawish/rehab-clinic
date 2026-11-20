// Data backfill of invoice_total_changes (see the migration).

/**
 * Rebuilds invoice_total_changes for every invoice that has no row yet, from
 * the audit log (migration InvoiceTotalChanges; kept out of the migration
 * file because TypeORM loads every export of a migration as a migration).
 * The e2e test compares it with the history the app records live.
 */
export async function backfillInvoiceTotalChanges(db: {
  query(sql: string): Promise<unknown>;
}): Promise<void> {
  // 1. Each audited total, at the time it was recorded: the creation at the
  // issue itself, a later change never before it (the audit time is the
  // transaction's start, which precedes issued_at by a few ms in the
  // creating transaction). Changes at one instant collapse to the last one:
  // a change the creating transaction made (a referral discount at
  // check-in) gives the total at the issue.
  await db.query(`
    INSERT INTO invoice_total_changes (invoice_id, changed_at, total)
    SELECT DISTINCT ON (e.invoice_id, e.changed_at) e.invoice_id, e.changed_at, e.total
      FROM (
        SELECT i.id AS invoice_id,
               (CASE WHEN a.action = 'INVOICE_CREATED' THEN i.issued_at
                     ELSE GREATEST(a.created_at, i.issued_at) END) AS changed_at,
               a.created_at AS audited_at,
               a.action,
               (CASE a.action
                  WHEN 'INVOICE_CREATED' THEN a.new_values ->> 'total'
                  WHEN 'DISCOUNT_APPLIED' THEN a.new_values ->> 'invoiceTotal'
                  WHEN 'DISCOUNT_REMOVED' THEN a.new_values ->> 'invoiceTotal'
                  ELSE a.new_values -> 'invoice' ->> 'total'
                END)::numeric(12,2) AS total
          FROM audit_logs a
          JOIN invoices i ON i.id = a.entity_id
         WHERE a.entity_type = 'INVOICE'
           AND a.action IN ('INVOICE_CREATED', 'INVOICE_ITEM_ADDED', 'INVOICE_ITEM_UPDATED',
                            'INVOICE_ITEM_REMOVED', 'DISCOUNT_APPLIED', 'DISCOUNT_REMOVED')
           AND NOT EXISTS (SELECT 1 FROM invoice_total_changes x WHERE x.invoice_id = i.id)
      ) e
     WHERE e.total IS NOT NULL
     ORDER BY e.invoice_id, e.changed_at, (e.action = 'INVOICE_CREATED'), e.audited_at DESC`);

  // 2. Incomplete history (no row at the issue, or not ending at the current
  // total): dropped, replaced below by the current total.
  await db.query(`
    DELETE FROM invoice_total_changes h
     USING invoices i
     WHERE h.invoice_id = i.id
       AND (NOT EXISTS (SELECT 1 FROM invoice_total_changes b
                         WHERE b.invoice_id = i.id AND b.changed_at = i.issued_at)
            OR (SELECT l.total FROM invoice_total_changes l
                 WHERE l.invoice_id = i.id
                 ORDER BY l.changed_at DESC LIMIT 1) <> i.total)`);

  // 3. Every invoice still without history: its current total from its issue.
  await db.query(`
    INSERT INTO invoice_total_changes (invoice_id, changed_at, total)
    SELECT i.id, i.issued_at, i.total FROM invoices i
     WHERE NOT EXISTS (SELECT 1 FROM invoice_total_changes h WHERE h.invoice_id = i.id)`);
}
