export default function ReceiptViewer({ url }: { url: string }) {
  return (
    <div className="aspect-[3/4] bg-slate-100 rounded-lg flex items-center justify-center border overflow-hidden">
      {url ? <img src={url} alt="Receipt" className="object-contain" /> : <span>No receipt image</span>}
    </div>
  );
}
