// SQL fragments for "as it was at an instant": every past day's money
// figures use the state in effect at its end, so a later discount, item
// edit, removal or cancellation never changes an earlier day. `cut` is a
// bind parameter ('$1'...), an instant (the start of the next local day).
// Invoices are aliased `i`, discounts `d`.

// Net valid money received on invoice `i` before `cut`: payments minus
// refunds. A voided row never counts (it was recorded by mistake: the money
// never moved), as in the daily summary's payments and every report.
export const PAID_BEFORE = (cut: string) => `COALESCE((
    SELECT SUM(CASE WHEN p.type = 'PAYMENT' THEN p.amount ELSE -p.amount END)
      FROM payments p
     WHERE p.invoice_id = i.id AND p.status = 'VALID' AND p.received_at < ${cut}), 0)`;

// The total of invoice `i` in effect at `cut`: its latest recorded change
// before then (invoice_total_changes). Without history (an invoice written
// outside InvoicesService): its current total.
export const TOTAL_AT = (cut: string) => `COALESCE((
    SELECT h.total FROM invoice_total_changes h
     WHERE h.invoice_id = i.id AND h.changed_at < ${cut}
     ORDER BY h.changed_at DESC LIMIT 1), i.total)`;

// The total of invoice `i` when it was issued (its first history row).
export const TOTAL_AT_ISSUE = `COALESCE((
    SELECT h.total FROM invoice_total_changes h
     WHERE h.invoice_id = i.id ORDER BY h.changed_at LIMIT 1), i.total)`;

// Invoice `i` was live at `cut`: issued before it and not cancelled by then.
export const LIVE_AT = (cut: string) =>
  `i.issued_at < ${cut} AND (i.status <> 'CANCELLED' OR i.cancelled_at >= ${cut})`;

// Invoice `i` was not cancelled by `cut` (whatever its issue time).
export const NOT_CANCELLED_AT = (cut: string) =>
  `(i.status <> 'CANCELLED' OR i.cancelled_at >= ${cut})`;

// Discount `d` was still in effect at `cut` (not removed or replaced by then).
export const DISCOUNT_ACTIVE_AT = (cut: string) =>
  `(d.removed_at IS NULL OR d.removed_at >= ${cut})`;
