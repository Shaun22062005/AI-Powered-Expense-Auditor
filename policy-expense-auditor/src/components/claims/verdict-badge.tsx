import React from 'react';
import { cn } from '@/lib/utils';

export type VerdictStatus = 'approved' | 'flagged' | 'rejected' | 'pending' | 'auditing';

interface VerdictBadgeProps {
  status: VerdictStatus;
  className?: string;
}

export default function VerdictBadge({ status, className }: VerdictBadgeProps) {
  const styles: Record<VerdictStatus, string> = {
    approved: 'bg-emerald-950/60 text-emerald-400 border-emerald-500/30 shadow-sm shadow-emerald-900/20',
    flagged: 'bg-amber-950/60 text-amber-300 border-amber-500/30 shadow-sm shadow-amber-900/20',
    rejected: 'bg-rose-950/60 text-rose-400 border-rose-500/30 shadow-sm shadow-rose-900/20',
    pending: 'bg-slate-900 text-slate-300 border-slate-700/60',
    auditing: 'bg-blue-950/60 text-blue-400 border-blue-500/30 animate-pulse',
  };

  const labels: Record<VerdictStatus, string> = {
    approved: 'Approved',
    flagged: 'Flagged',
    rejected: 'Rejected',
    pending: 'Pending',
    auditing: 'Auditing...',
  };

  return (
    <span className={cn(
      'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border uppercase tracking-wider',
      styles[status],
      className
    )}>
      {labels[status]}
    </span>
  );
}
