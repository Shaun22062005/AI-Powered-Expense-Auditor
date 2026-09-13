'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search, Filter, Eye, ArrowUpDown, ChevronRight, User, AlertCircle } from 'lucide-react';
import { cn, formatCurrency, formatDate } from '@/lib/utils';
import VerdictBadge from '@/components/claims/verdict-badge';

export default function ClaimsListPage() {
  const [claims, setClaims] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const router = useRouter();

  useEffect(() => {
    async function fetchClaims() {
      try {
        const res = await fetch('/api/claims');
        const data = await res.json();
        if (Array.isArray(data)) {
          // Sort by confidence score ascending (lowest first = highest risk)
          const sorted = data.sort((a, b) => (a.confidence_score || 0) - (b.confidence_score || 0));
          setClaims(sorted);
        }
      } catch (err) {
        console.error('Failed to fetch claims', err);
      } finally {
        setLoading(false);
      }
    }
    fetchClaims();
  }, []);

  const filteredClaims = claims.filter(claim => 
    claim.merchant.toLowerCase().includes(searchTerm.toLowerCase()) ||
    claim.category.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const getStatusBorder = (status: string) => {
    switch (status.toLowerCase()) {
      case 'rejected': return 'border-l-rose-500';
      case 'flagged': return 'border-l-amber-500';
      case 'approved': case 'compliant': return 'border-l-emerald-500';
      default: return 'border-l-slate-300';
    }
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8 bg-gray-950">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight">Audit Queue</h1>
          <p className="text-gray-500 mt-1">High-risk claims are prioritized at the top.</p>
        </div>
        
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input 
              type="text"
              placeholder="Search ID, merchant..."
              className="pl-10 pr-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm outline-none focus:ring-2 focus:ring-slate-900/10 transition-all w-64 text-white placeholder:text-gray-500"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="bg-gray-900 rounded-2xl border border-gray-800 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-800 border-b border-gray-700 text-xs uppercase font-bold text-gray-400 tracking-wider">
                <th className="px-6 py-4">Merchant</th>
                <th className="px-6 py-4">Amount</th>
                <th className="px-6 py-4">Category</th>
                <th className="px-6 py-4">Date</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4">Confidence</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800 min-h-96">
              {loading ? (
                [...Array(5)].map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    <td colSpan={7} className="px-6 py-4"><div className="h-8 bg-gray-800 rounded w-full" /></td>
                  </tr>
                ))
              ) : filteredClaims.map((claim) => (
                <tr 
                  key={claim.id} 
                  onClick={() => router.push(`/dashboard/claims/${claim.id}`)}
                  className={cn(
                    "group hover:bg-gray-800/50 cursor-pointer transition-colors border-l-4",
                    getStatusBorder(claim.status)
                  )}
                >
                  <td className="px-6 py-4 font-bold text-white">{claim.merchant}</td>
                  <td className="px-6 py-4 font-mono font-bold text-white">{formatCurrency(claim.amount)}</td>
                  <td className="px-6 py-4 text-sm text-gray-300">{claim.category}</td>
                  <td className="px-6 py-4 text-sm text-gray-300">{formatDate(claim.expense_date)}</td>
                  <td className="px-6 py-4">
                    <VerdictBadge status={claim.status.toLowerCase() as any} />
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <div className="w-12 bg-slate-100 h-1.5 rounded-full overflow-hidden">
                        <div 
                          className={cn(
                            "h-full rounded-full",
                            (claim.confidence_score || 0) < 50 ? "bg-rose-500" : "bg-emerald-500"
                          )}
                          style={{ width: `${(claim.confidence_score || 0)}%` }}
                        />
                      </div>
                      <span className="text-xs font-bold text-gray-300">{(claim.confidence_score || 0)}%</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <ChevronRight className="w-5 h-5 text-gray-600 group-hover:text-white transition-colors inline" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
