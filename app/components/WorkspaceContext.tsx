'use client';

import { createContext, useContext } from 'react';

export const WorkspaceContext = createContext({ sidebarOpen: false, setSidebarOpen: (_open: boolean) => { void _open; } });
export const useWorkspace = () => useContext(WorkspaceContext);
