import React from 'react';
import type { IOrg } from '../types';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface TopBarProps {
  title: string;
  orgs: IOrg[];
  activeOrgId: string;
  onActiveOrgChange: (orgId: string) => void;
}

export default function TopBar({ title, orgs, activeOrgId, onActiveOrgChange }: TopBarProps) {
  return (
    <header className="h-auto min-h-[3.5rem] lg:min-h-[4rem] bg-background border-b flex flex-wrap items-center justify-between pl-14 lg:pl-8 pr-4 lg:pr-8 py-2 text-sm shrink-0 gap-2">
      <h2 className="text-base lg:text-xl font-bold text-foreground tracking-wide truncate max-w-[50vw] lg:max-w-none">{title}</h2>
      
      {/* Restaurant / Organization Dropdown Selector */}
      {orgs.length > 0 && (
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest hidden sm:inline">Store:</span>
          <Select value={activeOrgId || ""} onValueChange={(val) => { if (val) onActiveOrgChange(val); }}>
            <SelectTrigger className="w-[180px] h-8 text-xs font-semibold bg-secondary/50 border-secondary">
              <SelectValue placeholder="Select Store">
                {orgs.find(o => o._id === activeOrgId)?.name || 'Select Store'}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {orgs.map((org) => (
                <SelectItem key={org._id} value={org._id}>
                  {org.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
    </header>
  );
}
