export default function Button({ children, className, ...props }: any) {
  return (
    <button className={`px-4 py-2 rounded-md font-medium transition-colors ${className}`} {...props}>
      {children}
    </button>
  );
}
