import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import LiveOrdersPage from './pages/LiveOrdersPage';
import CreateOrderPage from './pages/CreateOrderPage';
import DashboardPage from './pages/DashboardPage';
import DeliveriesPage from './pages/DeliveriesPage';
import SettingsPage from './pages/SettingsPage';
import RidersPage from './pages/RidersPage';
import AuditLogsPage from './pages/AuditLogsPage';
import RiderSimulatorPage from './pages/RiderSimulatorPage';
import api from './utils/api';
import type { IOrg } from './types';
import { RefreshCw } from 'lucide-react';
import { isTokenExpired } from './utils/jwt';
import { Toaster } from 'sonner';

function ProtectedRoutes() {
  const { user, loading, refreshAccessToken } = useAuth();
  const [orgs, setOrgs] = useState<IOrg[]>([]);
  const [activeOrgId, setActiveOrgId] = useState('');
  const [pageTitle, setPageTitle] = useState('Live Orders');
  const [validating, setValidating] = useState(true);
  const [tokenValid, setTokenValid] = useState(false);
  const location = useLocation();

  useEffect(() => {
    const checkToken = async () => {
      const token = localStorage.getItem('accessToken');
      if (!token) {
        setTokenValid(false);
        setValidating(false);
        return;
      }

      if (!isTokenExpired(token)) {
        setTokenValid(true);
        setValidating(false);
      } else {
        // Token is expired! Let's attempt silent refresh.
        try {
          console.log('[Route Guard] Token expired, attempting silent refresh...');
          await refreshAccessToken();
          setTokenValid(true);
        } catch (err) {
          console.error('[Route Guard] Silent refresh failed:', err);
          setTokenValid(false);
        } finally {
          setValidating(false);
        }
      }
    };

    checkToken();
  }, [location.pathname, refreshAccessToken]);

  useEffect(() => {
    if (!user || validating || !tokenValid) return;
    const fetchOrgs = async () => {
      try {
        const res = await api.get('/org/list');
        setOrgs(res.data);
        if (res.data.length > 0) {
          setActiveOrgId(res.data[0]._id);
        }
      } catch (err) {
        console.error(err);
      }
    };
    fetchOrgs();
  }, [user, validating, tokenValid]);

  // Sync title from path
  useEffect(() => {
    const path = location.pathname;
    if (path === '/') setPageTitle('Live Dispatch Desk');
    else if (path === '/create-order') setPageTitle('Create Delivery Order');
    else if (path === '/dashboard') setPageTitle('Merchant Dashboard');
    else if (path === '/deliveries') setPageTitle('Shipments Ledger');
    else if (path === '/wallet') setPageTitle('Billing Wallet');
    else if (path === '/settings') setPageTitle('Store Settings');
    else if (path === '/riders') setPageTitle('Fleet Management');
    else if (path === '/audit-logs') setPageTitle('Audit Registry Logs');
    else if (path === '/rider-simulator') setPageTitle('Rider Fleet Simulator');
  }, [location.pathname]);

  if (loading || validating) {
    return (
      <div className="min-h-screen bg-[#0a0e1a] flex flex-col items-center justify-center text-gray-500 gap-4">
        <RefreshCw className="w-8 h-8 animate-spin text-blue-500" />
        <span className="text-sm">Initiating console session...</span>
      </div>
    );
  }

  if (!user || !tokenValid) {
    return <Navigate to="/login" replace />;
  }

  return (
    <Routes>
      <Route
        element={
          <Layout
            orgs={orgs}
            activeOrgId={activeOrgId}
            onActiveOrgChange={setActiveOrgId}
            pageTitle={pageTitle}
          />
        }
      >
        <Route path="/" element={<LiveOrdersPage activeOrgId={activeOrgId} />} />
        <Route path="/create-order" element={<CreateOrderPage activeOrgId={activeOrgId} />} />
        <Route path="/dashboard" element={<DashboardPage activeOrgId={activeOrgId} />} />
        <Route path="/deliveries" element={<DeliveriesPage activeOrgId={activeOrgId} />} />
        <Route path="/settings" element={<SettingsPage activeOrgId={activeOrgId} />} />
        <Route path="/riders" element={<RidersPage activeOrgId={activeOrgId} />} />
        <Route path="/audit-logs" element={<AuditLogsPage />} />
        <Route path="/rider-simulator" element={<RiderSimulatorPage activeOrgId={activeOrgId} />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/*" element={<ProtectedRoutes />} />
        </Routes>
      </BrowserRouter>
      <Toaster position="bottom-right" theme="dark" closeButton />
    </AuthProvider>
  );
}
