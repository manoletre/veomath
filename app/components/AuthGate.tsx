'use client';

import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut, User } from 'firebase/auth';
import { usePathname } from 'next/navigation';
import { Fragment, useEffect, useState } from 'react';
import { auth } from '../lib/firebase-client';
import MathLogo from './MathLogo';
import { LoginButtonSocial1 } from '@/components/login-button-social-1';
import { Button } from '@/components/ui/button';

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [signingIn, setSigningIn] = useState(false);

  useEffect(() => onAuthStateChanged(auth, current => {
    setUser(current);
    setReady(true);
  }), []);

  // The headless animation tester needs to load this page without a user session.
  if (pathname === '/sandbox') return children;
  if (!ready) return <main className="auth-screen">Loading sign-in…</main>;
  if (!user) {
    return <main className="auth-screen">
      <div className="auth-card">
        <h1 style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <MathLogo size={36} />
          veomath
        </h1>
        <p>Sign in to create math visualizations.</p>
        <LoginButtonSocial1 disabled={signingIn} aria-busy={signingIn} onClick={async () => {
          setError('');
          setSigningIn(true);
          try { await signInWithPopup(auth, new GoogleAuthProvider()); }
          catch (err) { setError(err instanceof Error ? err.message : 'Sign-in failed'); }
          finally { setSigningIn(false); }
        }} />
        {error && <p role="alert" className="auth-error">{error}</p>}
      </div>
    </main>;
  }
  return <>
    <div className="account-bar">
      <span>{user.email}</span>
      <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => signOut(auth)}>Sign out</Button>
    </div>
    <Fragment key={user.uid}>{children}</Fragment>
  </>;
}
