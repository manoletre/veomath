'use client';

import { useState } from 'react';
import { PanelLeftClose, PanelLeftOpen, Plus, Trash2, UserRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useAccount } from './AccountContext';
import { useWorkspace } from './WorkspaceContext';

export default function WorkspaceHistory({ items, activeId, disabled, onNew, onSelect, onDelete, label }: {
  items: { id: string; title: string; createdAt: number }[];
  activeId: string;
  disabled: boolean;
  onNew: () => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  label: string;
}) {
  const { sidebarOpen, setSidebarOpen } = useWorkspace();
  const account = useAccount();
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState('');
  return <aside aria-label={`${label} history`} className="workspace-history flex shrink-0 flex-col overflow-hidden border-r border-border bg-card transition-[width]" style={{ width: sidebarOpen ? 220 : 52 }}>
    <div className="flex h-[72px] shrink-0 items-center justify-between gap-2 border-b border-border px-2">
      <Button variant="ghost" size="icon" className="size-9 shrink-0" aria-label={sidebarOpen ? 'Collapse history' : 'Expand history'} title={sidebarOpen ? 'Collapse history' : 'Expand history'} onClick={() => setSidebarOpen(!sidebarOpen)}>{sidebarOpen ? <PanelLeftClose /> : <PanelLeftOpen />}</Button>
      {sidebarOpen && <Button variant="outline" size="sm" disabled={disabled} onClick={onNew}><Plus />New</Button>}
    </div>
    {!sidebarOpen && <Button variant="ghost" size="icon" className="mx-auto mt-2 size-9" disabled={disabled} aria-label={`New ${label}`} title={`New ${label}`} onClick={onNew}><Plus /></Button>}
    {sidebarOpen && <div className="min-h-0 flex-1 overflow-y-auto p-2">
      {items.map(item => <div key={item.id} className="group relative mb-1">
        <Button variant={item.id === activeId ? 'secondary' : 'ghost'} disabled={disabled} aria-current={item.id === activeId ? 'true' : undefined} className="h-auto w-full justify-start whitespace-normal py-2 pl-2 pr-9 text-left" onClick={() => onSelect(item.id)} title={item.title}>
          <span className="min-w-0"><span className="block truncate text-base">{item.title}</span><span className="mt-0.5 block text-sm font-normal text-muted-foreground">{new Date(item.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}</span></span>
        </Button>
        <Button variant="ghost" size="icon" className="absolute right-0.5 top-1 size-8 opacity-60 hover:text-destructive hover:opacity-100 focus-visible:opacity-100" disabled={disabled} aria-label={`Delete ${item.title}`} onClick={() => onDelete(item.id)}><Trash2 className="size-3.5" /></Button>
      </div>)}
    </div>}
    {account && <div className="mt-auto shrink-0 border-t border-border p-2">
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="ghost" aria-label="Account" title={account.email || 'Account'} className={`h-9 gap-2 px-2 ${sidebarOpen ? 'w-full justify-start' : 'size-9'}`}>
            <UserRound className="size-5 shrink-0" />
            {sidebarOpen && <span className="min-w-0 flex-1 truncate text-left text-sm">{account.email || 'Account'}</span>}
          </Button>
        </PopoverTrigger>
        <PopoverContent aria-label="Account menu" side="top" align="start" className="w-44 p-1">
          <Button variant="ghost" disabled={signingOut} className="h-9 w-full justify-start px-2" onClick={async () => {
            setSigningOut(true);
            setSignOutError('');
            try { await account.signOut(); }
            catch { setSignOutError('Could not log out. Please try again.'); }
            finally { setSigningOut(false); }
          }}>{signingOut ? 'Logging out…' : 'Log out'}</Button>
          {signOutError && <p role="alert" className="px-2 py-1 text-sm text-destructive">{signOutError}</p>}
        </PopoverContent>
      </Popover>
    </div>}
  </aside>;
}
