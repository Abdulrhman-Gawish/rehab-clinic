// Roles of people who log in. Patients are NOT users and never log in.
export enum UserRole {
  OWNER = 'OWNER',
  DOCTOR = 'DOCTOR',
  RECEPTIONIST = 'RECEPTIONIST',
}

export const ALL_STAFF_ROLES = [
  UserRole.OWNER,
  UserRole.DOCTOR,
  UserRole.RECEPTIONIST,
] as const;
