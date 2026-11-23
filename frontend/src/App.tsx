import { lazy, useEffect, type ComponentType, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { getSession, showError, syncLanguageFromAccount } from './api';
import { useI18n } from './i18n';
import { homeFor, StaffLayout } from './layout/StaffLayout';
import { PublicLayout } from './layout/PublicLayout';
import { ButtonLink, DialogHost, EmptyState, Toasts } from './ui';
import { Login } from './pages/Login';
import { Home } from './pages/Home';
import { PublicBooking } from './pages/PublicBooking';
import { BlogAdmin, PublicBlog, PublicBlogPost } from './pages/Blog'; // its editor library loads on demand

// Staff pages load on demand (StaffLayout wraps them in Suspense), so the public website stays small.
function lazyPage<M>(load: () => Promise<M>, name: keyof M) {
  return lazy(async () => ({ default: (await load())[name] as ComponentType }));
}
const DayList = lazyPage(() => import('./pages/DayList'), 'DayList');
const Schedule = lazyPage(() => import('./pages/Schedule'), 'Schedule');
const Booking = lazyPage(() => import('./pages/Booking'), 'Booking');
const Patients = lazyPage(() => import('./pages/Patients'), 'Patients');
const PatientPage = lazyPage(() => import('./pages/Patients'), 'PatientPage');
const InvoicePage = lazyPage(() => import('./pages/Invoice'), 'InvoicePage');
const ReceiptPage = lazyPage(() => import('./pages/Invoice'), 'ReceiptPage');
const Expenses = lazyPage(() => import('./pages/Expenses'), 'Expenses');
const NeedsNote = lazyPage(() => import('./pages/NeedsNote'), 'NeedsNote');
const VisitPage = lazyPage(() => import('./pages/Visit'), 'VisitPage');
const Users = lazyPage(() => import('./pages/Owner'), 'Users');
const Doctors = lazyPage(() => import('./pages/Owner'), 'Doctors');
const DoctorPage = lazyPage(() => import('./pages/Owner'), 'DoctorPage');
const Services = lazyPage(() => import('./pages/Owner'), 'Services');
const Summary = lazyPage(() => import('./pages/Reports'), 'Summary');
const Attention = lazyPage(() => import('./pages/Reports'), 'Attention');
const AuditLog = lazyPage(() => import('./pages/Reports'), 'AuditLog');
const OwnerReports = lazyPage(() => import('./pages/Reports'), 'OwnerReports');
const MarketingReports = lazyPage(() => import('./pages/Referrals'), 'MarketingReports');
const ReferringDoctorPage = lazyPage(() => import('./pages/Referrals'), 'ReferringDoctorPage');
const ReferringDoctors = lazyPage(() => import('./pages/Referrals'), 'ReferringDoctors');
const Salaries = lazyPage(() => import('./pages/Salaries'), 'Salaries');
const Employees = lazyPage(() => import('./pages/Employees'), 'Employees');
const ClientReviews = lazyPage(() => import('./pages/ClientReviews'), 'ClientReviews');
const ClientReviewForm = lazyPage(() => import('./pages/ClientReviews'), 'ClientReviewForm');

export { homeFor };

/** Staff pages: the sidebar frame, only with a session (the API decides what each role may do). */
function Staff() {
  const loc = useLocation();
  return getSession() ? <StaffLayout /> : <Navigate to="/login" replace state={{ from: loc.pathname + loc.search }} />;
}

/**
 * Pages about salaries (doctors' and employees') and the client reviews: the OWNER only. The API refuses everyone else
 * anyway; this only keeps another role from landing on an empty page: they go to their own home.
 */
function OwnerOnly({ children }: { children: ReactNode }) {
  const session = getSession();
  return session?.user.role === 'OWNER' ? children : <Navigate to={session ? homeFor(session.user.role) : '/login'} replace />;
}

function NotFound() {
  const { t } = useI18n();
  const s = getSession();
  return (
    <EmptyState
      icon="alert-circle" title={t.ui.notFoundTitle} text={t.ui.notFoundText}
      action={<ButtonLink to={s ? homeFor(s.user.role) : '/'} variant="primary" icon="home">{t.nav.home}</ButtonLink>}
    />
  );
}

export function App() {
  const loc = useLocation();
  // A new page starts without the previous page's error.
  useEffect(() => showError(null), [loc.pathname]);
  // The account's language may have been changed on another device since this tab last saw it.
  useEffect(() => { syncLanguageFromAccount().catch(() => {}); }, []);
  // Each page starts at the top.
  useEffect(() => { window.scrollTo(0, 0); }, [loc.pathname]);
  return (
    <>
      <Routes>
        {/* Public website (no login) */}
        <Route element={<PublicLayout />}>
          <Route path="/" element={<Home />} />
          <Route path="/book" element={<PublicBooking />} />
          <Route path="/blog" element={<PublicBlog />} />
          <Route path="/blog/:id" element={<PublicBlogPost />} />
        </Route>
        <Route path="/login" element={<Login />} />

        {/* Staff app */}
        <Route element={<Staff />}>
          <Route path="/reception" element={<Schedule />} />
          <Route path="/reception/book" element={<Booking />} />
          <Route path="/reception/patients" element={<Patients />} />
          <Route path="/patients/:id" element={<PatientPage />} />
          <Route path="/reception/patients/:id" element={<PatientPage />} />
          <Route path="/visits/:id" element={<VisitPage />} />
          <Route path="/reception/invoices/:id" element={<InvoicePage />} />
          <Route path="/reception/receipts/:id" element={<ReceiptPage />} />
          <Route path="/reception/expenses" element={<Expenses />} />
          <Route path="/reception/summary" element={<Summary />} />
          <Route path="/doctor" element={<DayList />} />
          <Route path="/doctor/needs-note" element={<NeedsNote />} />
          <Route path="/doctor/visits/:id" element={<VisitPage />} />
          <Route path="/owner/summary" element={<Summary />} />
          <Route path="/owner/users" element={<Users />} />
          <Route path="/owner/doctors" element={<Doctors />} />
          <Route path="/owner/doctors/:id" element={<DoctorPage />} />
          <Route path="/owner/services" element={<Services />} />
          <Route path="/owner/packages" element={<Navigate to="/owner/services" replace />} />
          <Route path="/owner/reports" element={<OwnerReports />} />
          <Route path="/owner/referring-doctors" element={<ReferringDoctors />} />
          <Route path="/owner/referring-doctors/:id" element={<ReferringDoctorPage />} />
          <Route path="/owner/salaries" element={<OwnerOnly><Salaries /></OwnerOnly>} />
          <Route path="/owner/employees" element={<OwnerOnly><Employees /></OwnerOnly>} />
          <Route path="/owner/marketing" element={<MarketingReports />} />
          <Route path="/owner/attention" element={<Attention />} />
          <Route path="/owner/audit" element={<AuditLog />} />
          <Route path="/owner/blog" element={<BlogAdmin />} />
          <Route path="/owner/reviews" element={<OwnerOnly><ClientReviews /></OwnerOnly>} />
          <Route path="/owner/reviews/new" element={<OwnerOnly><ClientReviewForm /></OwnerOnly>} />
          <Route path="/owner/reviews/:id/edit" element={<OwnerOnly><ClientReviewForm /></OwnerOnly>} />
        </Route>

        <Route element={getSession() ? <StaffLayout /> : <PublicLayout />}>
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
      <Toasts />
      <DialogHost />
    </>
  );
}

