'use client';

import React, { useState, useEffect } from 'react';
import { Upload, FileText, CheckCircle, Loader2, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function SettingsPage() {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [ingestData, setIngestData] = useState<any>(null);

  useEffect(() => {
    const saved = localStorage.getItem('policy_upload_state');
    if (saved) {
      try {
        const data = JSON.parse(saved);
        setStatus('success');
        setIngestData(data);
      } catch (e) {
        console.error("Failed to parse saved policy state", e);
      }
    }
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
      setStatus('idle');
    }
  };

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;

    setStatus('loading');
    const formData = new FormData();
    formData.append('policy', file);

    try {
      const res = await fetch('/api/policy/ingest', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (res.ok) {
        const uploadState = { filename: file.name, chunkCount: data.chunkCount };
        setIngestData(uploadState);
        setStatus('success');
        localStorage.setItem('policy_upload_state', JSON.stringify(uploadState));
      } else {
        setStatus('error');
      }
    } catch (err) {
      setStatus('error');
    }
  };

  return (
    <div className="p-10 max-w-3xl mx-auto space-y-10 bg-gray-950 min-h-screen">
      <div>
        <h1 className="text-3xl font-bold text-white tracking-tight">Company Policy</h1>
        <p className="text-gray-400 mt-1">Ingest policy documents to update the RAG-based auditing engine.</p>
      </div>

      <div className="bg-gray-900 p-8 rounded-2xl border border-gray-800 shadow-sm space-y-8">
        <form onSubmit={handleUpload} className="space-y-6">
          <div className={cn(
            "border-2 border-dashed rounded-2xl p-12 text-center transition-all relative group",
            status === 'success' ? "border-emerald-200 bg-emerald-50" : "border-gray-700 bg-gray-800 hover:bg-gray-700"
          )}>
            <input 
              type="file" 
              className="absolute inset-0 opacity-0 cursor-pointer"
              onChange={handleFileChange}
              accept=".pdf"
            />
            
            {status === 'success' ? (
              <CheckCircle className="w-12 h-12 text-emerald-500 mx-auto mb-4" />
            ) : (
              <FileText className="w-12 h-12 text-slate-400 mx-auto mb-4 group-hover:text-slate-600 transition-colors" />
            )}
            
            <p className={cn(
              "text-lg font-bold",
              status === 'success' ? "text-emerald-800" : "text-white"
            )}>
              {file ? file.name : (ingestData?.filename || "Click to upload policy PDF")}
            </p>
            <p className="text-sm text-gray-500 mt-1">Only PDF files are supported for ingestion.</p>
          </div>

          {status !== 'success' && (
            <button 
              type="submit"
              disabled={!file || status === 'loading'}
              className="w-full py-4 bg-blue-600 text-white rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-blue-700 disabled:opacity-50 transition-all"
            >
              {status === 'loading' && <Loader2 className="w-5 h-5 animate-spin" />}
              {status === 'loading' ? 'Ingesting PDF...' : 'Update Policy Engine'}
            </button>
          )}
        </form>

        {status === 'success' && (
          <div className="space-y-4">
            <div className="p-4 bg-emerald-900/20 border border-emerald-800 rounded-xl flex gap-3 animate-in fade-in slide-in-from-top-2">
              <CheckCircle className="w-5 h-5 text-emerald-600 flex-shrink-0" />
              <div>
                <p className="text-sm font-bold text-emerald-800">Success!</p>
                <p className="text-sm text-emerald-700">
                  Policy ingested successfully. {ingestData?.chunkCount} knowledge chunks were added to the vector database.
                </p>
              </div>
            </div>
            <button 
              onClick={() => {
                localStorage.removeItem('policy_upload_state');
                setStatus('idle');
                setFile(null);
                setIngestData(null);
              }}
              className="w-full py-3 bg-gray-800 text-white rounded-xl font-bold hover:bg-gray-700 transition-all"
            >
              Upload New Policy
            </button>
          </div>
        )}

        {status === 'error' && (
          <div className="p-4 bg-rose-50 border border-rose-100 rounded-xl flex gap-3">
            <AlertCircle className="w-5 h-5 text-rose-600 flex-shrink-0" />
            <p className="text-sm text-rose-700">Failed to ingest policy. Please check the file and try again.</p>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="p-6 bg-gray-800 rounded-2xl border border-gray-700">
          <h4 className="font-bold text-white mb-2">How it works</h4>
          <p className="text-sm text-gray-400 leading-relaxed">
            Our engine splits your policy into semantic chunks, generates vector embeddings, and stores them in Qdrant. During audits, relevant sections are retrieved to provide context-aware reasoning.
          </p>
        </div>
        <div className="p-6 bg-gray-800 rounded-2xl border border-gray-700">
          <h4 className="font-bold text-white mb-2">Audit Accuracy</h4>
          <p className="text-sm text-gray-400 leading-relaxed">
            Updating the policy will immediately affect all future audits. Already processed claims will not be re-audited unless manually triggered.
          </p>
        </div>
      </div>
    </div>
  );
}
