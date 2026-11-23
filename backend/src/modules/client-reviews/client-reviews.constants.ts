// Limits of a client review (DTO validation; the keyword count is also a CHECK).
export const REVIEW_CONTENT_MAX = 5_000;
export const REVIEW_KEYWORDS_MAX = 20;
export const REVIEW_KEYWORD_MAX = 50;
// Active attachments per review. Each file: JPG, PNG, WEBP or PDF, at most
// MAX_UPLOAD_BYTES (the shared upload rule).
export const REVIEW_ATTACHMENTS_MAX = 10;
// The multipart file field (repeat it once per file).
export const REVIEW_ATTACHMENTS_FIELD = 'attachments';
// Stored files live under this FileStorage prefix (see the orphan sweep).
export const REVIEW_STORAGE_PREFIX = 'client-reviews/';
// A stored display name, after cleaning.
export const REVIEW_FILE_NAME_MAX = 200;
