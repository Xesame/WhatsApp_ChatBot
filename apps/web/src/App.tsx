import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { AdminShell } from './AdminShell.tsx';
import { Listing } from './firm/Listing.tsx';
import { Saved } from './firm/Saved.tsx';
import { Search } from './firm/Search.tsx';
import { DashboardShell } from './firm/Shell.tsx';
import { Team } from './firm/Team.tsx';
import { Entities } from './pages/Entities.tsx';
import { Firms } from './pages/Firms.tsx';
import { Groups } from './pages/Groups.tsx';
import { Jobs } from './pages/Jobs.tsx';
import { Login } from './pages/Login.tsx';
import { Overview } from './pages/Overview.tsx';
import { Review } from './pages/Review.tsx';
import { SetPassword } from './pages/SetPassword.tsx';
import { Settings } from './pages/Settings.tsx';
import { WhatsApp } from './pages/WhatsApp.tsx';

// Two apps in one: the firm dashboard under /app (Arabic or English) and the
// owner's admin console at / (English). Firm users never see the console.
export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/set-password" element={<SetPassword />} />
        <Route path="/app" element={<DashboardShell />}>
          <Route index element={<Search />} />
          <Route path="listings/:id" element={<Listing />} />
          <Route path="saved" element={<Saved />} />
          <Route path="team" element={<Team />} />
        </Route>
        <Route element={<AdminShell />}>
          <Route index element={<Overview />} />
          <Route path="firms" element={<Firms />} />
          <Route path="whatsapp" element={<WhatsApp />} />
          <Route path="groups" element={<Groups />} />
          <Route path="review" element={<Review />} />
          <Route path="names" element={<Entities />} />
          <Route path="jobs" element={<Jobs />} />
          <Route path="settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
