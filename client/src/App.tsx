import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AppShell } from './components/layout/AppShell';
import { LoginPage } from './components/auth/LoginPage';
import { ProtectedRoute } from './components/auth/ProtectedRoute';
import { DashboardPage } from './components/dashboard/DashboardPage';
import { TasksPage } from './components/tasks/TasksPage';
import { CustomersPage } from './components/customers/CustomersPage';
import { CustomerDetailPage } from './components/customers/CustomerDetailPage';
import { ContactsPage } from './components/contacts/ContactsPage';
import { ContactDetailPage } from './components/contacts/ContactDetailPage';
import { ContactDuplicatesPage } from './components/contacts/ContactDuplicatesPage';
import { CalendarPage } from './components/calendar/CalendarPage';
import { MailPage } from './components/mail/MailPage';
import { ReviewPage } from './components/mail/review/ReviewPage';
import { SettingsPage } from './components/settings/SettingsPage';
import { NotFoundPage } from './components/shared/NotFoundPage';
import { DealsPage } from './components/deals/DealsPage';
import { ActivityLogPage } from './components/audit/ActivityLogPage';

/**
 * Dev-only preview routes, loaded lazily.
 *
 * These were static imports, and a module-scope side effect in one of them
 * replaced several API modules with fixtures for the whole app — the
 * `import.meta.env.DEV` guard below gates rendering, not importing, and a
 * module-scope side effect cannot be tree-shaken, so it would have run in
 * production too. Importing them only when a dev route is actually visited means
 * the production bundle never contains them at all.
 */
const NullComponent = () => null;

// The ternary is what keeps these out of a production build entirely: Vite
// replaces `import.meta.env.DEV` with a literal, so the dynamic import sits in a
// branch Rollup can prove is dead and drops the chunk with it. Lazy alone left
// the harness in `dist/` — unreachable, since the routes below are not
// registered, but still shipped.
const OnboardingPreview = import.meta.env.DEV
  ? lazy(() => import('./dev/OnboardingPreview').then((m) => ({ default: m.OnboardingPreview })))
  : NullComponent;
const ComponentPreview = import.meta.env.DEV
  ? lazy(() => import('./dev/ComponentPreview').then((m) => ({ default: m.ComponentPreview })))
  : NullComponent;

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        {import.meta.env.DEV && (
          <Route
            path="/dev/onboarding"
            element={
              <Suspense fallback={null}>
                <OnboardingPreview />
              </Suspense>
            }
          />
        )}
        {import.meta.env.DEV && (
          <Route
            path="/dev/preview"
            element={
              <Suspense fallback={null}>
                <ComponentPreview />
              </Suspense>
            }
          />
        )}
        <Route element={<ProtectedRoute />}>
          <Route element={<AppShell />}>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/tasks" element={<TasksPage />} />
            <Route path="/customers" element={<CustomersPage />} />
            <Route path="/customers/:id" element={<CustomerDetailPage />} />
            <Route path="/contacts" element={<ContactsPage />} />
            {/* Above `/contacts/:id` — otherwise "duplicates" reads as an id. */}
            <Route path="/contacts/duplicates" element={<ContactDuplicatesPage />} />
            <Route path="/contacts/:id" element={<ContactDetailPage />} />
            <Route path="/deals" element={<DealsPage />} />
            <Route path="/calendar" element={<CalendarPage />} />
            <Route path="/mail" element={<MailPage />} />
            <Route path="/mail/review" element={<ReviewPage />} />
            <Route path="/activity" element={<ActivityLogPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            {/*
              Catch-all, INSIDE the shell so a wrong URL keeps the header and
              side nav and the user can navigate away.

              Without it an unmatched path rendered nothing at all: the sender
              avatar in the thread reader linked to `/companies/:id` — a route
              that has never existed, the real one being `/customers/:id` — and
              clicking it replaced the entire page with a blank white screen,
              with no way back except the browser's Back button. Fixing the two
              links removes today's dead end; this stops the next typo becoming
              one.
            */}
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
