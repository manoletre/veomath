'use client';

import { createContext, useContext } from 'react';

export const AccountContext = createContext<{ email: string | null; signOut: () => Promise<void> } | null>(null);
export const useAccount = () => useContext(AccountContext);
