import React from 'react';
import SubmitClaimForm from '@/components/forms/submit-claim-form';

export default function SubmitClaimPage() {
  return (
    <main className="min-h-screen bg-gray-950 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-2xl mx-auto space-y-8">
        <div className="text-center">
          <h1 className="text-4xl font-extrabold text-white tracking-tight">
            Submit Expense
          </h1>
          <p className="mt-2 text-lg text-gray-400">
            Upload your receipt and our AI will audit it against company policy instantly.
          </p>
        </div>

        <div className="bg-gray-900 p-8 rounded-2xl shadow-xl border border-gray-800">
          <SubmitClaimForm />
        </div>

        <div className="text-center text-sm text-gray-600">
          <p>© 2026 Auditor.ai. Automated Compliance Engine.</p>
        </div>
      </div>
    </main>
  );
}
