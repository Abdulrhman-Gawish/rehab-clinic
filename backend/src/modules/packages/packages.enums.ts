// A sold package. FINISHED = every session used (back to ACTIVE when one is
// restored). CANCELLED by the OWNER: the remaining sessions can't be used.
export enum PatientPackageStatus {
  ACTIVE = 'ACTIVE',
  FINISHED = 'FINISHED',
  CANCELLED = 'CANCELLED',
}

// Why a session was used: the patient attended, or didn't show up.
export enum PackageUsageReason {
  ATTENDED = 'ATTENDED',
  NO_SHOW = 'NO_SHOW',
}
