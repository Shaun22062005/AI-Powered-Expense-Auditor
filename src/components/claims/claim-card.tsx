export default function ClaimCard({ claim }: { claim: any }) {
  return (
    <div className="p-4 border rounded-lg bg-white shadow-sm flex justify-between items-center">
      <div>
        <h3 className="font-semibold">{claim.merchant}</h3>
        <p className="text-sm text-slate-500">{claim.date}</p>
      </div>
      <div className="text-right">
        <p className="font-bold">${claim.amount}</p>
        <span className="text-xs uppercase px-2 py-1 rounded bg-slate-100">{claim.status}</span>
      </div>
    </div>
  );
}
