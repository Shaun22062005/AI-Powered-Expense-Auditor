export default function Input({ className, ...props }: any) {
  return (
    <input className={`w-full px-3 py-2 border rounded-md outline-none focus:ring-2 focus:ring-slate-400 ${className}`} {...props} />
  );
}
