'use client';

export default function UploadPolicyForm() {
  return (
    <form className="space-y-4">
      <input type="file" className="block w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-slate-50 file:text-slate-700 hover:file:bg-slate-100" />
      <button className="bg-slate-900 text-white px-4 py-2 rounded-lg text-sm font-bold">
        Ingest Policy
      </button>
    </form>
  );
}
