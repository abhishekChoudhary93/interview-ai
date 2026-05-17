import { Toaster } from '@/components/ui/toaster';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClientInstance } from '@/lib/query-client';
import { BrowserRouter as Router, Route, Routes, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import { useToast } from '@/components/ui/use-toast';
import PageNotFound from '@/lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import { MarketProvider } from '@/lib/MarketContext';
import { SubscriptionProvider } from '@/lib/SubscriptionContext';
import RequireAuth from '@/components/RequireAuth';
import Layout from '@/components/Layout';
import Landing from '@/pages/Landing';
import Login from '@/pages/Login';
import Register from '@/pages/Register';
import Setup from '@/pages/Setup';
import Interview from '@/pages/Interview';
import Report from '@/pages/Report';
import Dashboard from '@/pages/Dashboard';
import History from '@/pages/History';
import Billing from '@/pages/Billing';
import DebugTimeline from '@/pages/DebugTimeline';

const AppRoutes = () => {
  const { isLoadingAuth } = useAuth();
  const location = useLocation();
  const { dismiss } = useToast();

  useEffect(() => {
    dismiss();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  if (isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route element={<RequireAuth />}>
        <Route path="/interview" element={<Interview />} />
        <Route path="/interview/:id/debug" element={<DebugTimeline />} />
        <Route element={<Layout />}>
          <Route path="/setup" element={<Setup />} />
          <Route path="/report" element={<Report />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/history" element={<History />} />
          <Route path="/billing" element={<Billing />} />
        </Route>
      </Route>
      <Route path="*" element={<PageNotFound />} />
    </Routes>
  );
};

function App() {
  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <MarketProvider>
          <SubscriptionProvider>
            <Router>
              <AppRoutes />
            </Router>
            <Toaster />
          </SubscriptionProvider>
        </MarketProvider>
      </QueryClientProvider>
    </AuthProvider>
  );
}

export default App;
