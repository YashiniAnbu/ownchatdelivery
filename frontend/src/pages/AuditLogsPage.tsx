import React, { useState, useEffect } from 'react';
import api from '../utils/api';
import { FileText, RefreshCw, ChevronLeft, ChevronRight, Download } from 'lucide-react';

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export default function AuditLogsPage() {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedLog, setSelectedLog] = useState<any | null>(null);

  // Filters
  const [action, setAction] = useState('');
  const [startDate, setStartDate] = useState('');

  // Pagination
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const fetchAuditLogs = async () => {
    setLoading(true);
    try {
      const params: any = {
        page,
        limit: 15
      };
      if (action && action !== 'all') params.action = action;
      if (startDate) params.startDate = startDate;

      const res = await api.get('/audit-logs', { params });
      setLogs(res.data.logs || []);
      setTotalPages(res.data.pagination?.pages || 1);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadCSV = () => {
    let url = `http://localhost:3000/api/audit-logs?download=true`;
    if (action && action !== 'all') url += `&action=${action}`;
    if (startDate) url += `&startDate=${startDate}`;
    window.open(url, '_blank');
  };

  useEffect(() => {
    fetchAuditLogs();
  }, [page, action, startDate]);

  const handleClearFilters = () => {
    setAction('');
    setStartDate('');
    setPage(1);
  };

  return (
    <div className="space-y-6">
      {/* Title */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2">
        <div>
          <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Audit Registry</h3>
          <p className="text-sm text-muted-foreground mt-0.5">Immutable tracking logs of dispatch, assignments, and changes.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleDownloadCSV} className="gap-1.5 h-9">
            <Download size={12} />
            Download CSV
          </Button>
        </div>
      </div>

      {/* Filter toolbar */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

        {/* Action Type */}
        <Select value={action || "all"} onValueChange={(val) => { if (val) { setAction(val === "all" ? "" : val); setPage(1); } }}>
          <SelectTrigger>
            <SelectValue placeholder="All Actions" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Actions</SelectItem>
            <SelectItem value="LOGIN">User Authentication</SelectItem>
            <SelectItem value="ORDER_CREATED">Order Dispatched</SelectItem>
            <SelectItem value="operational">Operational Logs (No Login/Logout)</SelectItem>
          </SelectContent>
        </Select>

        {/* Start Date & Clear */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Input
              type="date"
              value={startDate}
              onChange={(e) => { setStartDate(e.target.value); setPage(1); }}
            />
          </div>
          {(action || startDate) && (
            <Button
              variant="secondary"
              onClick={handleClearFilters}
              className="px-3"
            >
              Clear
            </Button>
          )}
        </div>
      </div>

      {/* Logs Table */}
      <div className="border rounded-xl bg-background shadow-sm overflow-hidden flex flex-col">
        <div className="overflow-auto max-h-[600px] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:bg-secondary [&::-webkit-scrollbar-track]:bg-transparent">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm shadow-[0_1px_0_0_hsl(var(--border))]">
              <TableRow className="bg-secondary/30 hover:bg-secondary/30 border-b-0">
                <TableHead className="rounded-tl-lg h-11 text-foreground/80 font-semibold">Timestamp</TableHead>
                <TableHead className="h-11 text-foreground/80 font-semibold">Actor</TableHead>
                <TableHead className="h-11 text-foreground/80 font-semibold">Action</TableHead>
                <TableHead className="h-11 text-foreground/80 font-semibold">Target Type</TableHead>
                <TableHead className="rounded-tr-lg h-11 text-foreground/80 font-semibold">Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i} className="hover:bg-transparent">
                    <TableCell><div className="h-4 w-32 bg-secondary animate-pulse rounded" /></TableCell>
                    <TableCell>
                      <div className="space-y-2">
                        <div className="h-4 w-24 bg-secondary animate-pulse rounded" />
                        <div className="h-3 w-16 bg-secondary animate-pulse rounded" />
                      </div>
                    </TableCell>
                    <TableCell><div className="h-5 w-20 bg-secondary animate-pulse rounded-full" /></TableCell>
                    <TableCell><div className="h-4 w-24 bg-secondary animate-pulse rounded" /></TableCell>
                    <TableCell><div className="h-4 w-48 bg-secondary animate-pulse rounded" /></TableCell>
                  </TableRow>
                ))
              ) : logs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-64 text-center">
                    <div className="flex flex-col items-center justify-center text-muted-foreground gap-3">
                      <div className="w-12 h-12 rounded-full bg-secondary/50 flex items-center justify-center mb-2">
                        <FileText className="w-6 h-6 opacity-40" />
                      </div>
                      <span className="text-sm font-medium text-foreground">No audit entries found</span>
                      <span className="text-xs opacity-70">Try adjusting your filters or date range.</span>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                logs.map((log) => {
                  let badgeVariant: "default" | "secondary" | "destructive" | "outline" = "outline";
                  let badgeClassName = "";

                  if (log.action === 'ORDER_CREATED') {
                    badgeClassName = 'bg-amber-500/10 text-amber-500 border-amber-500/20';
                  } else if (log.action === 'LOGIN') {
                    badgeClassName = 'bg-purple-500/10 text-purple-500 border-purple-500/20';
                  } else if (log.action === 'STATUS_UPDATE') {
                    badgeClassName = 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20';
                  } else if (log.action === 'LOGOUT') {
                    badgeVariant = "secondary";
                  } else {
                    badgeClassName = 'bg-primary/10 text-primary border-primary/20';
                  }

                  const isClickable = log.action !== 'LOGIN' && log.action !== 'LOGOUT';
                  return (
                    <TableRow 
                      key={log._id} 
                      className={`hover:bg-muted/30 transition-all group ${isClickable ? 'cursor-pointer hover:shadow-sm hover:-translate-y-[1px]' : ''}`}
                      onClick={() => isClickable && setSelectedLog(log)}
                    >
                      <TableCell className="text-muted-foreground font-mono">
                        {new Date(log.createdAt).toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <span className="font-bold text-foreground">{log.actorName}</span>
                        <span className="text-[9px] text-muted-foreground uppercase block font-bold tracking-wider mt-0.5">
                          ({log.actorType})
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge variant={badgeVariant} className={`text-[9px] font-bold uppercase tracking-wider ${badgeClassName}`}>
                          {log.action}
                        </Badge>
                      </TableCell>
                      <TableCell className="capitalize text-muted-foreground">
                        {log.targetType}
                      </TableCell>
                      <TableCell className="text-muted-foreground font-mono text-[10px] max-w-xs truncate">
                        {isClickable ? (
                          <span className="text-primary hover:underline">Click to view details</span>
                        ) : (
                          <span title={JSON.stringify(log.metadata)}>{JSON.stringify(log.metadata)}</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Pagination Controls */}
      {totalPages > 1 && (
        <div className="flex justify-between items-center text-xs text-muted-foreground">
          <span>Page {page} of {totalPages}</span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="icon"
              disabled={page <= 1}
              onClick={() => setPage(p => p - 1)}
            >
              <ChevronLeft size={16} />
            </Button>
            <Button
              variant="outline"
              size="icon"
              disabled={page >= totalPages}
              onClick={() => setPage(p => p + 1)}
            >
              <ChevronRight size={16} />
            </Button>
          </div>
        </div>
      )}

      {/* Log Details Modal */}
      <Dialog open={!!selectedLog} onOpenChange={(open) => !open && setSelectedLog(null)}>
        <DialogContent className="max-w-2xl bg-white text-slate-800 border-none shadow-xl">
          <DialogHeader className="border-b pb-4 mb-4">
            <DialogTitle className="flex items-center gap-3">
              <span className="text-lg font-black">Audit Details</span>
              {selectedLog && (
                <Badge variant="outline" className="text-[9px] font-bold uppercase tracking-wider bg-primary/5 text-primary border-primary/20">
                  {selectedLog.action}
                </Badge>
              )}
            </DialogTitle>
          </DialogHeader>
          
          {selectedLog && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-widest block mb-1">Timestamp</span>
                  <div className="font-mono bg-slate-50 px-2 py-1.5 rounded text-slate-600 text-xs">
                    {new Date(selectedLog.createdAt).toLocaleString()}
                  </div>
                </div>
                <div>
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-widest block mb-1">Target</span>
                  <div className="font-semibold text-slate-700 bg-slate-50 px-2 py-1.5 rounded flex flex-col">
                    <span className="capitalize">{selectedLog.targetType}</span>
                    <span className="text-[10px] text-slate-400 font-mono break-all leading-tight">{selectedLog.targetId}</span>
                  </div>
                </div>
                <div>
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-widest block mb-1">Actor</span>
                  <div className="font-semibold text-slate-700 bg-slate-50 px-2 py-1.5 rounded">
                    {selectedLog.actorName} <span className="text-[10px] text-slate-400 font-normal uppercase tracking-wider ml-1">({selectedLog.actorType})</span>
                  </div>
                </div>
                <div>
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-widest block mb-1">IP Address</span>
                  <div className="font-mono bg-slate-50 px-2 py-1.5 rounded text-slate-600 text-xs break-all">
                    {selectedLog.ip || 'Unknown'}
                  </div>
                </div>
              </div>

              <div>
                <span className="text-xs font-bold text-slate-400 uppercase tracking-widest block mb-2">Metadata</span>
                <div className="bg-slate-900 text-slate-300 p-4 rounded-xl overflow-x-auto overflow-y-auto max-h-[40vh] text-xs font-mono border shadow-inner">
                  <pre>{JSON.stringify(selectedLog.metadata, null, 2)}</pre>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
