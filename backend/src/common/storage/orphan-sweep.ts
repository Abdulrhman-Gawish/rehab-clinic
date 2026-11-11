import type { DataSource } from 'typeorm';
import type { FileStorage, StoredKey } from './file-storage.service.js';

const MINUTE_MS = 60_000;

/**
 * Where each kind of stored file is recorded. Only these prefixes are swept;
 * anything else under STORAGE_LOCAL_PATH is never touched.
 * - Attachments: the patient_attachments row.
 * - Receipts: the current one on the expense, and every replaced one through
 *   the EXPENSE_RECEIPT_UPLOADED audit entry written in the same transaction
 *   (old receipts are kept on purpose, so they always count as referenced).
 * - Blog covers: the post (deleted ones too), and every replaced one through
 *   the BLOG_POST_UPDATED audit entry (same rule as receipts).
 */
const REFERENCES: { prefix: string; sql: string }[] = [
  {
    prefix: 'patients/',
    sql: 'SELECT file_key AS key FROM patient_attachments',
  },
  {
    prefix: 'expenses/',
    sql: `SELECT receipt_file_key AS key FROM expenses WHERE receipt_file_key IS NOT NULL
          UNION
          SELECT new_values->>'receiptFileKey' FROM audit_logs
           WHERE action = 'EXPENSE_RECEIPT_UPLOADED' AND new_values ? 'receiptFileKey'
          UNION
          SELECT old_values->>'receiptFileKey' FROM audit_logs
           WHERE action = 'EXPENSE_RECEIPT_UPLOADED' AND old_values->>'receiptFileKey' IS NOT NULL`,
  },
  {
    prefix: 'blog/',
    sql: `SELECT cover_image_key AS key FROM blog_posts
          UNION
          SELECT old_values->>'coverImageKey' FROM audit_logs
           WHERE action = 'BLOG_POST_UPDATED' AND old_values ? 'coverImageKey'`,
  },
];

/**
 * Files that no committed row (or receipt audit entry) points to: left by
 * a crash between writing the file and committing its row. Files younger
 * than `minAgeMinutes` are skipped, since their upload may still be running.
 */
export async function findOrphans(
  storage: FileStorage,
  dataSource: DataSource,
  now: Date,
  minAgeMinutes: number,
): Promise<StoredKey[]> {
  const cutoff = now.getTime() - minAgeMinutes * MINUTE_MS;
  const orphans: StoredKey[] = [];
  for (const { prefix, sql } of REFERENCES) {
    const rows: { key: string }[] = await dataSource.query(sql);
    const referenced = new Set(rows.map((row) => row.key));
    for (const file of await storage.list(prefix)) {
      if (file.modifiedAt.getTime() < cutoff && !referenced.has(file.key)) {
        orphans.push(file);
      }
    }
  }
  return orphans;
}
