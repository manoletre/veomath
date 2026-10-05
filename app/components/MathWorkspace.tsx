'use client';

import { useState } from 'react';
import ChatWorkspace from './ChatWorkspace';
import { WorkspaceContext } from './WorkspaceContext';

export default function MathWorkspace() {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return <WorkspaceContext.Provider value={{ sidebarOpen, setSidebarOpen }}>
    <ChatWorkspace />
  </WorkspaceContext.Provider>;
}
