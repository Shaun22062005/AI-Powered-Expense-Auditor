'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Loader2, CheckCircle2, XCircle, AlertTriangle, ExternalLink, ShieldAlert } from 'lucide-react';
import { cn, formatCurrency, formatDate } from '@/lib/utils';
import VerdictBadge from '@/components/claims/verdict-badge';

export default function ClaimDetailsPage({ params }: { params: { id: string } }) {
  const [claim, setClaim] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const router = useRouter();

  useEffect(() => {
    async function fetchClaim() {
      try {
        const res = await fetch(`/api/claims/${params.id}`);
        const data = await res.json();
        setClaim(data);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    fetchClaim();
  }, [params.id]);

  const handleOverride = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const payload = {
      claim_id: params.id,
      new_status: formData.get('new_status'),
      justification: formData.get('justification'),
      manager_id: '00000000-0000-0000-0000-000000000000',
    };

    setSubmitting(true);
    try {
      const res = await fetch('/api/overrides', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        // Refresh claim data
        const updated = await fetch(`/api/claims/${params.id}`).then(r => r.json());
        setClaim(updated);
        alert('Override applied successfully');
      }
    } catch (err) {
      alert('Failed to apply override');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return (
    <div className="flex items-center justify-center h-full">
      <Loader2 className="w-8 h-8 animate-spin text-slate-400" />
    </div>
  );

  if (!claim) return <div className="p-8 text-center">Claim not found.</div>;

  return (
    <div className="h-full flex flex-col">
      <div className="border-b bg-gray-900 border-gray-800 p-4 flex items-center justify-between">
        <button 
          onClick={() => router.back()}
          className="flex items-center gap-2 text-sm font-medium text-gray-400 hover:text-white transition-colors"
        >
          <ArrowLeft className="w-4 h-4" /> Back to Queue
        </button>
        <div className="flex items-center gap-4">
          <span className="text-sm font-mono text-gray-500">ID: {claim.id}</span>
          <VerdictBadge status={claim.status.toLowerCase() as any} />
        </div>
      </div>

      <div className="flex-1 overflow-hidden flex flex-col lg:flex-row">
        {/* Left Panel: Receipt */}
        <div className="lg:w-1/3 border-r border-gray-800 bg-gray-950 p-6 overflow-y-auto">
          <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden p-2">
            <img 
              src={`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/receipts/${claim.receipt_storage_path}`} 
              alt="Receipt" 
              className="w-full h-auto rounded-lg"
              onError={(e) => (e.currentTarget.src = 'https://placehold.co/400x600?text=Receipt+Not+Found')}
            />
          </div>
        </div>

        {/* Middle Panel: Claim Data */}
        <div className="lg:w-1/3 border-r border-gray-800 bg-gray-900 p-8 overflow-y-auto">
          <h2 className="text-lg font-bold text-white mb-6 flex items-center gap-2">
            Claim Details
          </h2>
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <p className="text-xs font-bold text-gray-500 uppercase">Merchant</p>
                <p className="font-bold text-white">{claim.merchant}</p>
              </div>
              <div className="space-y-1">
                <p className="text-xs font-bold text-gray-500 uppercase">Amount</p>
                <p className="font-bold text-white text-lg">{formatCurrency(claim.amount)}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <p className="text-xs font-bold text-gray-500 uppercase">Category</p>
                <p className="font-medium text-gray-300">{claim.category}</p>
              </div>
              <div className="space-y-1">
                <p className="text-xs font-bold text-gray-500 uppercase">Date</p>
                <p className="font-medium text-gray-300">{formatDate(claim.expense_date)}</p>
              </div>
            </div>
            <div className="space-y-2">
              <p className="text-xs font-bold text-gray-500 uppercase">Business Purpose</p>
              <p className="text-sm text-gray-300 bg-gray-800 p-4 rounded-lg leading-relaxed border border-gray-700">
                {claim.business_purpose || "No purpose provided."}
              </p>
            </div>
          </div>
        </div>

        {/* Right Panel: AI Verdict & Override */}
        <div className="lg:w-1/3 bg-gray-950 p-8 overflow-y-auto space-y-8">
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-white">AI Audit Verdict</h2>
              <div className="text-right">
                <p className="text-xs font-bold text-gray-500 uppercase">Confidence</p>
                <p className={cn(
                  "text-lg font-bold",
                  (claim.audit_logs?.[0]?.confidence_score || 0) < 50 ? "text-rose-600" : "text-emerald-600"
                )}>{claim.audit_logs?.[0]?.confidence_score || 0}%</p>
              </div>
            </div>
            
            <div className={cn(
              "p-4 rounded-xl border flex gap-3",
              claim.status === 'rejected' ? "bg-rose-100/50 border-rose-200" : "bg-emerald-100/50 border-emerald-200"
            )}>
              {claim.status === 'rejected' ? <ShieldAlert className="w-5 h-5 text-rose-600" /> : <CheckCircle2 className="w-5 h-5 text-emerald-600" />}
              <p className="text-sm font-medium text-slate-800">{claim.audit_logs?.[0]?.reason || "Audit complete."}</p>
            </div>

            {claim.audit_logs?.[0]?.policy_excerpt && (
              <div className="space-y-2">
                <p className="text-xs font-bold text-gray-500 uppercase">Referenced Policy</p>
                <blockquote className="text-sm italic text-gray-400 border-l-4 border-blue-500 pl-4 py-1">
                  "{claim.audit_logs?.[0]?.policy_excerpt}"
                </blockquote>
              </div>
            )}
          </section>

          <section className="bg-gray-900 p-6 rounded-2xl border border-gray-800 shadow-sm space-y-4">
            <h3 className="font-bold text-white">Manual Override</h3>
            <form onSubmit={handleOverride} className="space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-500 uppercase">New Status</label>
                <select 
                  name="new_status"
                  className="w-full p-2 border border-gray-700 rounded-lg text-sm bg-gray-800 text-white"
                  defaultValue={claim.status}
                >
                  <option value="approved">Approve</option>
                  <option value="flagged">Flag for Review</option>
                  <option value="rejected">Reject</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-500 uppercase">Justification</label>
                <textarea 
                  name="justification"
                  rows={3}
                  className="w-full p-2 border border-gray-700 rounded-lg text-sm resize-none bg-gray-800 text-white"
                  placeholder="Explain why you are overriding the AI verdict..."
                  required
                />
              </div>
              <button 
                type="submit"
                disabled={submitting}
                className="w-full py-2 bg-blue-600 text-white rounded-lg text-sm font-bold hover:bg-blue-700 disabled:opacity-50 transition-all"
              >
                {submitting ? "Applying..." : "Confirm Override"}
              </button>
            </form>
          </section>
        </div>
      </div>
    </div>
  );
}
