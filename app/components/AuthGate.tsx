'use client';

import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut, User } from 'firebase/auth';
import { usePathname } from 'next/navigation';
import { Fragment, useEffect, useState } from 'react';
import { auth } from '../lib/firebase-client';
import Landing from './Landing';
import { AccountContext } from './AccountContext';

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
    return <Landing signingIn={signingIn} error={error} onSignIn={async () => {
      setError('');
      setSigningIn(true);
      try { await signInWithPopup(auth, new GoogleAuthProvider()); }
      catch (err) { setError(err instanceof Error ? err.message : 'Sign-in failed'); }
      finally { setSigningIn(false); }
    }} />;
  }
  return <AccountContext.Provider value={{ email: user.email, signOut: () => signOut(auth) }}>
    <Fragment key={user.uid}>{children}</Fragment>
  </AccountContext.Provider>;
}
