'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { LayoutDashboard, FileText, Settings, ShieldCheck, LogOut } from 'lucide-react';
import { cn } from '@/lib/utils';
import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
);

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push('/');
  };

  const navItems = [
    { label: 'Overview', href: '/dashboard', icon: LayoutDashboard },
    { label: 'Audit Queue', href: '/dashboard/claims', icon: FileText },
    { label: 'Upload Policy', href: '/dashboard/settings', icon: Settings },
  ];

  return (
    <aside className="w-64 border-r border-gray-800 bg-gray-950 flex flex-col">
      <div className="h-16 border-b border-gray-800 flex items-center px-6 gap-3">
        <div className="bg-slate-900 p-1.5 rounded-lg">
          <ShieldCheck className="w-5 h-5 text-white" />
        </div>
        <span className="font-bold text-lg tracking-tight text-white">Auditor.ai</span>
      </div>
      
      <nav className="flex-1 p-4 space-y-1">
        {navItems.map((item) => {
          const isActive = item.href === '/dashboard' ? pathname === '/dashboard' : pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link 
              key={item.href} 
              href={item.href}
              className={cn(
                "flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all group",
                isActive 
                  ? "bg-blue-600 text-white shadow-none" 
                  : "text-gray-400 hover:bg-gray-800 hover:text-white"
              )}
            >
              <item.icon className={cn(
                "w-5 h-5 transition-colors",
                isActive ? "text-white" : "text-gray-500 group-hover:text-white"
              )} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="p-4 border-t border-gray-800">
        <button 
          onClick={handleSignOut}
          className="flex items-center gap-3 px-4 py-2 text-sm font-semibold text-red-400 hover:bg-red-950 w-full rounded-xl transition-colors"
        >
          <LogOut className="w-5 h-5" />
          Log Out
        </button>
      </div>
    </aside>
  );
}
