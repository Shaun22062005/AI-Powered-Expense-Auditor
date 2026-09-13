'use client';

import React, { useState, useCallback } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Upload, Loader2, CheckCircle2, AlertCircle, XCircle, ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import VerdictBadge from '@/components/claims/verdict-badge';
import Link from 'next/link';

const schema = z.object({
  merchant: z.string().min(2, 'Merchant must be at least 2 characters'),
  amount: z.coerce.number().positive('Amount must be a positive number'),
  currency: z.enum(['USD', 'EUR', 'GBP', 'INR']),
  category: z.enum(['Meals', 'Travel', 'Lodging', 'Transport', 'Other']),
  expense_date: z.string().refine((date) => new Date(date) <= new Date(), {
    message: 'Date cannot be in the future',
  }),
  business_purpose: z.string().min(20, 'Business purpose must be at least 20 characters'),
});

type FormData = z.infer<typeof schema>;

export default function SubmitClaimForm() {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'result'>('idle');
  const [auditResult, setAuditResult] = useState<any>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      currency: 'USD',
      category: 'Meals',
    },
  });

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
    }
  };

  const onSubmit = async (data: FormData) => {
    if (!file) return alert('Please upload a receipt file');
    
    setStatus('loading');
    
    try {
      const formData = new FormData();
      formData.append('receipt', file);
      formData.append('merchant', data.merchant);
      formData.append('amount', String(data.amount));
      formData.append('currency', data.currency);
      formData.append('category', data.category);
      formData.append('expense_date', data.expense_date);
      formData.append('business_purpose', data.business_purpose);

      const response = await fetch('/api/audit', {
        method: 'POST',
        body: formData,
      });

      const result = await response.json();
      setAuditResult(result);
      setStatus('result');
    } catch (error) {
      console.error('Audit failed', error);
      alert('Audit failed. Please try again.');
      setStatus('idle');
    }
  };

  if (status === 'loading') {
    return (
      <div className="flex flex-col items-center justify-center py-20 space-y-4">
        <Loader2 className="w-12 h-12 text-blue-400 animate-spin" />
        <h2 className="text-xl font-bold text-white">Auditing your claim...</h2>
        <p className="text-gray-400">Cross-referencing your receipt with company policies.</p>
      </div>
    );
  }

  if (status === 'result' && auditResult) {
    console.log('Audit Result:', auditResult);
    const verdict = auditResult?.audit?.verdict?.toLowerCase() as any;
    const isApproved = verdict === 'approved' || verdict === 'compliant';
    
    return (
      <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-2 text-gray-400 hover:text-white transition-colors text-sm font-medium"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Dashboard
        </Link>

        <div className={cn(
          "p-6 rounded-xl border flex gap-4 items-start",
          isApproved ? "bg-emerald-50 border-emerald-100" : "bg-rose-50 border-rose-100"
        )}>
          {isApproved ? (
            <CheckCircle2 className="w-6 h-6 text-emerald-600 mt-1 flex-shrink-0" />
          ) : (
            <XCircle className="w-6 h-6 text-rose-600 mt-1 flex-shrink-0" />
          )}
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <h3 className="font-bold text-slate-900">Audit Result</h3>
              <VerdictBadge status={verdict === 'compliant' ? 'approved' : verdict} />
            </div>
            <p className="text-slate-700 leading-relaxed">
              {auditResult?.audit?.reason}
            </p>
          </div>
        </div>

        {auditResult?.audit?.policy_quotes && (
          <div className="p-6 bg-slate-50 rounded-xl border border-slate-200">
            <h4 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-3">Policy Context</h4>
            <div className="space-y-3">
              {auditResult.audit.policy_quotes.map((quote: string, i: number) => (
                <p key={i} className="text-sm text-slate-600 italic">"{quote}"</p>
              ))}
            </div>
          </div>
        )}

        <button 
          onClick={() => { setStatus('idle'); reset(); setFile(null); }}
          className="w-full py-3 bg-slate-900 text-white rounded-lg font-bold hover:bg-slate-800 transition-colors"
        >
          Submit Another Claim
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      <Link
        href="/dashboard"
        className="inline-flex items-center gap-2 text-gray-400 hover:text-white transition-colors text-sm font-medium"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Dashboard
      </Link>
      <div className="space-y-4">
        <div className="flex flex-col items-center justify-center border-2 border-dashed rounded-xl p-8 bg-gray-800 hover:bg-gray-700 border-gray-600 transition-colors relative cursor-pointer group">
          <input
            type="file"
            className="absolute inset-0 opacity-0 cursor-pointer"
            onChange={onFileChange}
            accept=".jpg,.jpeg,.png,.pdf"
          />
          <Upload className="w-10 h-10 text-slate-400 group-hover:text-slate-600 mb-3" />
          <p className="text-sm font-medium text-gray-300">
            {file ? file.name : "Click to upload or drag and drop receipt"}
          </p>
          <p className="text-xs text-gray-500 mt-1">JPG, PNG, PDF only</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1">
            <label className="text-sm font-bold text-gray-300">Merchant Name</label>
            <input
              {...register('merchant')}
              className={cn(
                "w-full px-4 py-2 border rounded-lg outline-none focus:ring-2 focus:ring-slate-400 transition-all text-white bg-gray-800 border-gray-700 placeholder:text-gray-500",
                errors.merchant ? "border-rose-500 bg-rose-50" : ""
              )}
              placeholder="e.g. Starbucks"
            />
            {errors.merchant && <p className="text-xs text-rose-500 font-medium">{errors.merchant.message}</p>}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-sm font-bold text-gray-300">Amount</label>
              <input
                {...register('amount')}
                type="number"
                step="0.01"
                className={cn(
                  "w-full px-4 py-2 border rounded-lg outline-none focus:ring-2 focus:ring-slate-400 transition-all text-white bg-gray-800 border-gray-700 placeholder:text-gray-500",
                  errors.amount ? "border-rose-500 bg-rose-50" : ""
                )}
                placeholder="0.00"
              />
              {errors.amount && <p className="text-xs text-rose-500 font-medium">{errors.amount.message}</p>}
            </div>
            <div className="space-y-1">
              <label className="text-sm font-bold text-gray-300">Currency</label>
              <select
                {...register('currency')}
                className="w-full px-4 py-2 border bg-gray-800 border-gray-700 rounded-lg outline-none focus:ring-2 focus:ring-slate-400 transition-all text-white"
              >
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
                <option value="GBP">GBP</option>
                <option value="INR">INR</option>
              </select>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1">
            <label className="text-sm font-bold text-gray-300">Category</label>
            <select
              {...register('category')}
              className="w-full px-4 py-2 border bg-gray-800 border-gray-700 rounded-lg outline-none focus:ring-2 focus:ring-slate-400 transition-all text-white"
            >
              <option value="Meals">Meals</option>
              <option value="Travel">Travel</option>
              <option value="Lodging">Lodging</option>
              <option value="Transport">Transport</option>
              <option value="Other">Other</option>
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-sm font-bold text-gray-300">Expense Date</label>
            <input
              {...register('expense_date')}
              type="date"
              className={cn(
                "w-full px-4 py-2 border rounded-lg outline-none focus:ring-2 focus:ring-slate-400 transition-all text-white bg-gray-800 border-gray-700 placeholder:text-gray-500",
                errors.expense_date ? "border-rose-500 bg-rose-50" : ""
              )}
            />
            {errors.expense_date && <p className="text-xs text-rose-500 font-medium">{errors.expense_date.message}</p>}
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-sm font-bold text-gray-300">Business Purpose</label>
          <textarea
            {...register('business_purpose')}
            rows={3}
            className={cn(
              "w-full px-4 py-2 border rounded-lg outline-none focus:ring-2 focus:ring-slate-400 transition-all resize-none text-white bg-gray-800 border-gray-700 placeholder:text-gray-500",
              errors.business_purpose ? "border-rose-500 bg-rose-50" : ""
            )}
            placeholder="Describe why this expense was incurred..."
          />
          {errors.business_purpose && <p className="text-xs text-rose-500 font-medium">{errors.business_purpose.message}</p>}
        </div>
      </div>

      <button
        type="submit"
        className="w-full py-4 bg-blue-600 text-white rounded-xl font-bold shadow-none hover:bg-blue-700 hover:-translate-y-0.5 transition-all active:translate-y-0"
      >
        Extract & Review
      </button>
    </form>
  );
}
