import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AppShell } from './components/layout/AppShell';
import { LoginPage } from './components/auth/LoginPage';
import { ProtectedRoute } from './components/auth/ProtectedRoute';
import { OnboardingPreview } from './dev/OnboardingPreview';
import { ComponentPreview } from './dev/ComponentPreview';
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
import { DealsPage } from './components/deals/DealsPage';
import { ActivityLogPage } from './components/audit/ActivityLogPage';

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        {import.meta.env.DEV && (
          <Route path="/dev/onboarding" element={<OnboardingPreview />} />
        )}
        {import.meta.env.DEV && <Route path="/dev/preview" element={<ComponentPreview />} />}
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
          </Route>
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
