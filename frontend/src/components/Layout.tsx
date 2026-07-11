import React from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import type { IOrg } from '../types';

interface LayoutProps {
  orgs: IOrg[];
  activeOrgId: string;
  onActiveOrgChange: (orgId: string) => void;
  pageTitle: string;
}

export default function Layout({ orgs, activeOrgId, onActiveOrgChange, pageTitle }: LayoutProps) {
  return (
    <div className="flex h-screen bg-slate-50 text-slate-800 overflow-hidden">
      {/* Left Sidebar */}
      <Sidebar />

      {/* Main Panel */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top Header Bar */}
        <TopBar
          title={pageTitle}
          orgs={orgs}
          activeOrgId={activeOrgId}
          onActiveOrgChange={onActiveOrgChange}
        />

        {/* Page Content area */}
        <main className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
