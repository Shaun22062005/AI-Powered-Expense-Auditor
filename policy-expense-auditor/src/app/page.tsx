'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ShieldCheck } from 'lucide-react';
import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
);

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError) {
      setError(signInError.message);
      setLoading(false);
    } else {
      router.push('/dashboard');
    }
  };

  const handleSignUp = async () => {
    setError(null);
    setLoading(true);

    const { error: signUpError } = await supabase.auth.signUp({
      email,
      password,
    });

    if (signUpError) {
      setError(signUpError.message);
    } else {
      setError('Check your email for the confirmation link!');
    }
    setLoading(false);
  };

  return (
    <main className="min-h-screen flex items-center justify-center bg-[#0F1117] px-4 py-12">
      <div className="max-w-md w-full">
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8 shadow-2xl">
          <div className="flex flex-col items-center mb-8">
            <div className="w-12 h-12 bg-blue-600/10 rounded-xl flex items-center justify-center mb-4 border border-blue-600/20">
              <ShieldCheck className="w-8 h-8 text-blue-600" />
            </div>
            <h1 className="text-3xl font-bold text-white mb-2">Auditor.ai</h1>
            <p className="text-gray-500 font-medium tracking-wide uppercase text-xs">
              Expense Compliance Platform
            </p>
          </div>

          <form onSubmit={handleSignIn} className="space-y-6">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-400 mb-2">
                Email
              </label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Enter your email"
                className="bg-gray-800 border border-gray-700 text-white rounded-lg px-4 py-3 w-full focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent transition-all placeholder:text-gray-600"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-400 mb-2">
                Password
              </label>
              <input
                id="password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                className="bg-gray-800 border border-gray-700 text-white rounded-lg px-4 py-3 w-full focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent transition-all placeholder:text-gray-600"
              />
            </div>

            {error && (
              <p className={`text-sm text-center ${error.includes('confirmation') ? 'text-green-500' : 'text-red-500'}`}>
                {error}
              </p>
            )}

            <div className="space-y-3">
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-xl transition-colors shadow-lg shadow-blue-600/20 active:scale-[0.98] disabled:opacity-50"
              >
                {loading ? 'Processing...' : 'Sign In'}
              </button>
              
              <button
                type="button"
                onClick={handleSignUp}
                disabled={loading}
                className="w-full bg-transparent border border-gray-700 hover:border-gray-600 text-gray-300 font-medium py-3 rounded-xl transition-colors active:scale-[0.98] disabled:opacity-50"
              >
                Sign Up
              </button>
            </div>

            <p className="text-gray-600 text-xs text-center mt-6">
              Secure authentication via Supabase
            </p>
          </form>
        </div>
      </div>
    </main>
  );
}
