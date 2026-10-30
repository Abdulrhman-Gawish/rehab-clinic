// Demo staff created by scripts/seed-demo.ts. The OWNER comes from backend/.env (see vite.config.ts).
export const DEMO_PASSWORD = 'Demo12345!';

export const DEMO_STAFF = [
  { role: 'RECEPTIONIST', name: 'Rana Reception', email: 'reception@demo.local' },
  { role: 'DOCTOR', name: 'Dr. Ahmed Hassan', email: 'ahmed@demo.local', specialty: 'Physiotherapy' },
  { role: 'DOCTOR', name: 'Dr. Mona Saleh', email: 'mona@demo.local', specialty: 'Sports rehab' },
  { role: 'DOCTOR', name: 'Dr. Karim Adel', email: 'karim@demo.local', specialty: 'Manual therapy' },
] as const;
