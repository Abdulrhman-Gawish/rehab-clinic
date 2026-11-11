// Token lifetimes. Fixed on purpose: no clinic needs to tune them.
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const REFRESH_TOKEN_TTL_DAYS = 7;
// A token rotated less than this long ago is a race (parallel requests, two
// tabs), not a replay: answer REFRESH_RACE and keep the session.
export const REFRESH_RACE_GRACE_SECONDS = 30;
