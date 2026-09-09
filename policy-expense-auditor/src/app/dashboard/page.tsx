'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { 
  Plus, 
  Receipt, 
  RotateCw, 
  TrendingUp, 
  CheckCircle2, 
  AlertTriangle, 
  XCircle, 
  ArrowUpRight,
  ShieldCheck,
  Calendar,
  Layers,
  Sparkles
} from 'lucide-react';
import VerdictBadge, { VerdictStatus } from '@/components/claims/verdict-badge';
import { formatCurrency, formatDate } from '@/lib/utils';

interface Claim {
  id: string;
  merchant: string;
  category: string;
  expense_date: string;
  amount: number;
  currency: string;
  status: VerdictStatus;
}

export default function DashboardPage() {
  const [claims, setClaims] = useState<Claim[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchClaims = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/claims');
      if (!response.ok) {
        throw new Error(`Failed to load claims (${response.status})`);
      }
      const data = await response.json();
      setClaims(Array.isArray(data) ? data : []);
    } catch (err: unknown) {
      console.error('Failed to fetch claims:', err);
      setError(err instanceof Error ? err.message : 'Unable to connect to expense service.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchClaims();
  }, [fetchClaims]);

  // Aggregate Metrics
  const totalSubmitted = claims.reduce((sum, claim) => sum + (Number(claim.amount) || 0), 0);
  const totalReimbursable = claims
    .filter((c) => c.status === 'approved')
    .reduce((sum, claim) => sum + (Number(claim.amount) || 0), 0);
  const pendingReview = claims
    .filter((c) => c.status === 'flagged' || c.status === 'auditing' || c.status === 'pending')
    .reduce((sum, claim) => sum + (Number(claim.amount) || 0), 0);
  const totalRejected = claims
    .filter((c) => c.status === 'rejected')
    .reduce((sum, claim) => sum + (Number(claim.amount) || 0), 0);

  const stats = [
    { 
      label: 'Total Expenses', 
      value: formatCurrency(totalSubmitted), 
      meta: `${claims.length} claims submitted`,
      icon: TrendingUp,
      color: 'text-white',
      badgeBg: 'bg-blue-500/10 text-blue-400 border-blue-500/20'
    },
    { 
      label: 'Approved Reimbursement', 
      value: formatCurrency(totalReimbursable), 
      meta: 'Compliant with policy',
      icon: CheckCircle2,
      color: 'text-emerald-400',
      badgeBg: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
    },
    { 
      label: 'Pending / In Review', 
      value: formatCurrency(pendingReview), 
      meta: 'Requires auditor eyes',
      icon: AlertTriangle,
      color: 'text-amber-300',
      badgeBg: 'bg-amber-500/10 text-amber-300 border-amber-500/20'
    },
    { 
      label: 'Policy Violations', 
      value: formatCurrency(totalRejected), 
      meta: 'Non-reimbursable',
      icon: XCircle,
      color: 'text-rose-400',
      badgeBg: 'bg-rose-500/10 text-rose-400 border-rose-500/20'
    },
  ];

  return (
    <div className="min-h-screen bg-[#0A0D14] text-slate-100 selection:bg-blue-600/30 selection:text-blue-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 md:py-12 space-y-8">
        
        {/* Header Block: Deliberate Typography Hierarchy & Primary CTA */}
        <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-800/80 pb-6">
          <div className="space-y-1">
            <div className="flex items-center gap-2.5">
              <div className="h-8 w-8 rounded-lg bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-blue-400">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
                Compliance Command Center
              </h1>
            </div>
            <p className="text-sm text-slate-400 font-normal">
              Autonomous two-stage policy auditing & receipt verification overview.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => fetchClaims()}
              disabled={loading}
              title="Refresh expenses"
              aria-label="Refresh expenses list"
              className="inline-flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-sm font-medium text-slate-300 bg-slate-900 border border-slate-800 hover:bg-slate-800/80 hover:text-white transition-all duration-150 active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <RotateCw className={`w-4 h-4 ${loading ? 'animate-spin text-blue-400' : ''}`} />
              <span className="hidden sm:inline">Refresh</span>
            </button>

            <Link
              href="/submit"
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-white bg-blue-600 hover:bg-blue-500 transition-all duration-150 shadow-lg shadow-blue-600/20 active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0A0D14]"
            >
              <Plus className="w-4 h-4" />
              <span>Submit Expense</span>
            </Link>
          </div>
        </header>

        {/* 60-30-10 Surface Elevation: Metrics Cards Grid */}
        <section aria-label="Executive Metrics" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-5">
          {stats.map((stat) => {
            const Icon = stat.icon;
            return (
              <div 
                key={stat.label}
                className="group relative bg-[#111622] rounded-2xl border border-slate-800/70 p-5 md:p-6 shadow-sm hover:border-slate-700/80 transition-all duration-150"
              >
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                    {stat.label}
                  </span>
                  <div className={`p-2 rounded-xl border ${stat.badgeBg}`}>
                    <Icon className="w-4 h-4" />
                  </div>
                </div>
                
                <div className="space-y-1">
                  <p className={`text-2xl sm:text-3xl font-bold tracking-tight tabular-nums ${stat.color}`}>
                    {loading ? (
                      <span className="inline-block h-8 w-28 bg-slate-800/70 rounded-lg animate-pulse" />
                    ) : (
                      stat.value
                    )}
                  </p>
                  <p className="text-xs text-slate-500 font-medium">
                    {stat.meta}
                  </p>
                </div>
              </div>
            );
          })}
        </section>

        {/* Main Data Container */}
        <main className="bg-[#111622] rounded-2xl border border-slate-800/70 shadow-sm overflow-hidden">
          {/* Table Header Controls */}
          <div className="px-6 py-4 border-b border-slate-800/80 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-[#131927]">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-blue-400" />
              <h2 className="text-sm font-bold uppercase tracking-wider text-slate-200">
                Recent Expense Audits
              </h2>
              <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-slate-800 text-slate-400 border border-slate-700/60 tabular-nums">
                {claims.length}
              </span>
            </div>

            <div className="flex items-center gap-2 text-xs text-slate-400">
              <Sparkles className="w-3.5 h-3.5 text-blue-400" />
              <span>Two-stage cross-encoder audited</span>
            </div>
          </div>

          {/* STATE 1: ERROR STATE */}
          {error ? (
            <div className="p-12 text-center flex flex-col items-center justify-center space-y-4">
              <div className="w-12 h-12 rounded-2xl bg-rose-500/10 border border-rose-500/30 flex items-center justify-center text-rose-400">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-semibold text-white">Failed to retrieve expense claims</h3>
                <p className="text-sm text-slate-400 max-w-md mx-auto">{error}</p>
              </div>
              <button
                onClick={() => fetchClaims()}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 transition-all active:scale-[0.98]"
              >
                <RotateCw className="w-4 h-4" />
                Retry Connection
              </button>
            </div>
          ) : (
            /* Tabular Content with Responsive Overflow Shell */
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-800 bg-[#0E121B] text-slate-400 text-xs font-semibold uppercase tracking-wider">
                    <th scope="col" className="py-3.5 px-6">Merchant & Policy Match</th>
                    <th scope="col" className="py-3.5 px-6">Category</th>
                    <th scope="col" className="py-3.5 px-6">Expense Date</th>
                    <th scope="col" className="py-3.5 px-6 text-right">Amount</th>
                    <th scope="col" className="py-3.5 px-6 text-center">Compliance Status</th>
                    <th scope="col" className="py-3.5 px-6 text-right">Action</th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-slate-800/60 text-sm font-normal">
                  {/* STATE 2: LOADING SKELETON (Geometry Matching Real Data) */}
                  {loading ? (
                    Array.from({ length: 4 }).map((_, i) => (
                      <tr key={`skeleton-${i}`} className="animate-pulse">
                        <td className="py-4 px-6">
                          <div className="space-y-2">
                            <div className="h-4 w-36 bg-slate-800/80 rounded" />
                            <div className="h-3 w-24 bg-slate-800/40 rounded" />
                          </div>
                        </td>
                        <td className="py-4 px-6">
                          <div className="h-4 w-20 bg-slate-800/60 rounded" />
                        </td>
                        <td className="py-4 px-6">
                          <div className="h-4 w-24 bg-slate-800/60 rounded" />
                        </td>
                        <td className="py-4 px-6 text-right">
                          <div className="h-4 w-16 bg-slate-800/80 rounded ml-auto" />
                        </td>
                        <td className="py-4 px-6 text-center">
                          <div className="h-5 w-24 bg-slate-800/60 rounded-full mx-auto" />
                        </td>
                        <td className="py-4 px-6 text-right">
                          <div className="h-4 w-12 bg-slate-800/40 rounded ml-auto" />
                        </td>
                      </tr>
                    ))
                  ) : claims.length === 0 ? (
                    /* STATE 3: ACTIONABLE EMPTY STATE */
                    <tr>
                      <td colSpan={6} className="py-16 px-6 text-center">
                        <div className="max-w-sm mx-auto flex flex-col items-center space-y-4">
                          <div className="w-14 h-14 rounded-2xl bg-blue-600/10 border border-blue-500/20 flex items-center justify-center text-blue-400">
                            <Receipt className="w-7 h-7" />
                          </div>
                          <div className="space-y-1">
                            <h3 className="text-base font-bold text-white tracking-tight">
                              No expense claims registered
                            </h3>
                            <p className="text-sm text-slate-400">
                              Upload a receipt to trigger two-stage policy retrieval, boundary checks, and automated compliance auditing.
                            </p>
                          </div>
                          <Link
                            href="/submit"
                            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-white bg-blue-600 hover:bg-blue-500 shadow-md shadow-blue-600/20 transition-all active:scale-[0.98]"
                          >
                            <Plus className="w-4 h-4" />
                            Submit First Expense
                          </Link>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    /* STATE 4: POPULATED DATA ROWS */
                    claims.map((claim) => (
                      <tr 
                        key={claim.id} 
                        className="hover:bg-slate-800/30 transition-colors duration-100 group"
                      >
                        <td className="py-4 px-6">
                          <div className="flex flex-col">
                            <span className="font-semibold text-white group-hover:text-blue-400 transition-colors">
                              {claim.merchant || 'Unknown Merchant'}
                            </span>
                            <span className="text-xs text-slate-500 font-mono tracking-tight">
                              ID: {claim.id.slice(0, 8)}...
                            </span>
                          </div>
                        </td>

                        <td className="py-4 px-6">
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-medium bg-slate-800 text-slate-300 border border-slate-700/60">
                            {claim.category || 'General'}
                          </span>
                        </td>

                        <td className="py-4 px-6 text-slate-400">
                          <div className="inline-flex items-center gap-1.5 text-xs text-slate-400">
                            <Calendar className="w-3.5 h-3.5 text-slate-500" />
                            <span>{formatDate(claim.expense_date)}</span>
                          </div>
                        </td>

                        {/* Financial figures right-aligned with tabular numbers */}
                        <td className="py-4 px-6 text-right font-bold text-white tabular-nums tracking-tight">
                          {formatCurrency(claim.amount, claim.currency)}
                        </td>

                        <td className="py-4 px-6 text-center">
                          <VerdictBadge status={claim.status} />
                        </td>

                        <td className="py-4 px-6 text-right">
                          <Link
                            href={`/dashboard/claims/${claim.id}`}
                            className="inline-flex items-center gap-1 text-xs font-semibold text-slate-400 hover:text-blue-400 transition-colors group-hover:translate-x-0.5 transform duration-150"
                          >
                            <span>Inspect</span>
                            <ArrowUpRight className="w-3.5 h-3.5" />
                          </Link>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
