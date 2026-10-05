'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { apiFetch, responseError } from '../lib/api-fetch';
import { auth } from '../lib/firebase-client';
import { PROMPT_EXAMPLES } from '../lib/prompt-examples';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { ArrowUp, Code2, Copy, RotateCcw, X } from 'lucide-react';
import WorkspaceHistory from './WorkspaceHistory';
import PromptSuggestions from './PromptSuggestions';
import MathLogo from './MathLogo';

const ManimRenderer = dynamic(() => import('./ManimRenderer'), { ssr: false });

type Message = {
  role: 'user' | 'assistant';
  content: string;
  manimCode?: string;
};

type AnimationHistoryItem = {
  code: string;
  label: string;
};

type DebugInfo = {
  code: string;
  error: string;
};

type Chat = {
  id: string;
  title: string;
  messages: Message[];
  currentCode: string | null;
  animationHistory: AnimationHistoryItem[];
  createdAt: number;
};

function createChat(): Chat {
  return {
    id: crypto.randomUUID(),
    title: 'New chat',
    messages: [],
    currentCode: null,
    animationHistory: [],
    createdAt: Date.now(),
  };
}

export default function ChatWorkspace() {
  const [chats, setChats] = useState<Chat[]>([]);
  const [activeChatId, setActiveChatId] = useState('');
  const [loading, setLoading] = useState(false);
  const [isAutoRetrying, setIsAutoRetrying] = useState(false);
  const [debugInfo, setDebugInfo] = useState<DebugInfo | null>(null);
  const [input, setInput] = useState('');
  const [promptIndex, setPromptIndex] = useState(0);
  const [renderKey, setRenderKey] = useState(0);
  const [showCodePanel, setShowCodePanel] = useState(false);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [manimExports, setManimExports] = useState<string[]>([]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const hasRetriedRef = useRef(false);
  const lastUserLabelRef = useRef('');
  const currentFrameRef = useRef<string | null>(null);
  const activeChatIdRef = useRef('');
  const chatsRef = useRef<Chat[]>([]);

  useEffect(() => { activeChatIdRef.current = activeChatId; }, [activeChatId]);
  useEffect(() => { chatsRef.current = chats; }, [chats]);

  useEffect(() => {
    if (input || loading) return;
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        setPromptIndex(index => (index + 1) % PROMPT_EXAMPLES.length);
      }
    }, 5000);
    return () => window.clearInterval(interval);
  }, [input, loading]);

  // Load from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem(`veomath-chats-${auth.currentUser?.uid}`);
    if (saved) {
      try {
        const parsed: Chat[] = JSON.parse(saved);
        if (parsed.length > 0) {
          setChats(parsed);
          setActiveChatId(parsed[0].id);
          activeChatIdRef.current = parsed[0].id;
          return;
        }
      } catch { }
    }
    const fresh = createChat();
    setChats([fresh]);
    setActiveChatId(fresh.id);
    activeChatIdRef.current = fresh.id;
  }, []);

  // Persist to localStorage
  useEffect(() => {
    if (chats.length > 0) {
      localStorage.setItem(`veomath-chats-${auth.currentUser?.uid}`, JSON.stringify(chats));
    }
  }, [chats]);

  const activeChat = chats.find(c => c.id === activeChatId) ?? null;

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeChat?.messages.length, loading]);

  const handleRuntimeError = useCallback((error: string) => {
    setRuntimeError(error);
  }, []);

  const handleReady = useCallback((exportKeys: string[]) => {
    setManimExports(exportKeys);
  }, []);

  const showAnimation = useCallback((code: string, label?: string) => {
    setRuntimeError(null);
    setChats(prev => prev.map(c => {
      if (c.id !== activeChatIdRef.current) return c;
      const newHistory = label
        ? [...c.animationHistory.filter(h => h.code !== code), { code, label }].slice(-8)
        : c.animationHistory;
      return { ...c, currentCode: code, animationHistory: newHistory };
    }));
    setRenderKey(k => k + 1);
    setDebugInfo(null);
  }, []);

  function newChat() {
    const chat = createChat();
    setChats(prev => [chat, ...prev]);
    setActiveChatId(chat.id);
    activeChatIdRef.current = chat.id;
    setDebugInfo(null);
    setRuntimeError(null);
    setInput('');
    currentFrameRef.current = null;
    hasRetriedRef.current = false;
    setRenderKey(k => k + 1);
  }

  function switchChat(id: string) {
    if (id === activeChatId || loading) return;
    setActiveChatId(id);
    activeChatIdRef.current = id;
    setDebugInfo(null);
    setRuntimeError(null);
    setInput('');
    currentFrameRef.current = null;
    hasRetriedRef.current = false;
    setRenderKey(k => k + 1);
  }

  function deleteChat(id: string) {
    if (loading) return;
    setChats(prev => {
      const remaining = prev.filter(c => c.id !== id);
      if (remaining.length === 0) {
        const fresh = createChat();
        setActiveChatId(fresh.id);
        activeChatIdRef.current = fresh.id;
        return [fresh];
      }
      if (id === activeChatIdRef.current) {
        const idx = prev.findIndex(c => c.id === id);
        const next = remaining[Math.min(idx, remaining.length - 1)];
        setActiveChatId(next.id);
        activeChatIdRef.current = next.id;
      }
      return remaining;
    });
    setDebugInfo(null);
    setRuntimeError(null);
    setInput('');
    currentFrameRef.current = null;
    hasRetriedRef.current = false;
    setRenderKey(k => k + 1);
  }

  const handleRenderError = useCallback(async (failedCode: string, error: string) => {
    setDebugInfo({ code: failedCode, error });
    if (hasRetriedRef.current) return;
    hasRetriedRef.current = true;
    setIsAutoRetrying(true);
    setLoading(true);

    try {
      const chat = chatsRef.current.find(c => c.id === activeChatIdRef.current);
      const msgs = chat?.messages ?? [];
      const lastAssistantIdx = msgs.reduce((last, m, i) => m.role === 'assistant' ? i : last, -1);
      const msgsForRetry = lastAssistantIdx >= 0 ? msgs.slice(0, lastAssistantIdx) : msgs;

      const res = await apiFetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: activeChatIdRef.current,
          messages: msgsForRetry.map(m => ({
            role: m.role,
            content: m.role === 'assistant' && m.manimCode
              ? m.content + '\n\n```javascript\n' + m.manimCode + '\n```'
              : m.content,
          })),
          retryContext: { failedCode, error },
          currentFrame: currentFrameRef.current,
        }),
      });

      if (!res.ok) throw await responseError(res);
      const data: { explanation: string; manimCode: string } = await res.json();
      const fixedMessage: Message = { role: 'assistant', content: data.explanation, manimCode: data.manimCode };

      setChats(prev => prev.map(c => {
        if (c.id !== activeChatIdRef.current) return c;
        const updated = [...c.messages];
        const lastIdx = updated.reduce((last, m, i) => m.role === 'assistant' ? i : last, -1);
        if (lastIdx >= 0) updated[lastIdx] = fixedMessage;
        else updated.push(fixedMessage);
        return { ...c, messages: updated };
      }));

      showAnimation(data.manimCode, lastUserLabelRef.current);
    } catch (err) {
      console.error('Auto-retry failed:', err);
    } finally {
      setLoading(false);
      setIsAutoRetrying(false);
    }
  }, [showAnimation]);

  const handleRenderSuccess = useCallback((frame: string | null) => {
    setDebugInfo(null);
    if (frame) currentFrameRef.current = frame;
  }, []);

  async function callApi(messages: Message[]) {
    const res = await apiFetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: activeChatIdRef.current,
        messages: messages.map(m => ({
          role: m.role,
          content: m.role === 'assistant' && m.manimCode
            ? m.content + '\n\n```javascript\n' + m.manimCode + '\n```'
            : m.content,
        })),
        currentFrame: currentFrameRef.current,
      }),
    });
    if (!res.ok) throw await responseError(res);
    return res.json() as Promise<{ explanation: string; manimCode: string }>;
  }

  async function sendMessage() {
    if (!input.trim() || loading || !activeChat) return;

    const userMessage: Message = { role: 'user', content: input.trim() };
    lastUserLabelRef.current = input.trim();
    hasRetriedRef.current = false;

    const newMessages = [...activeChat.messages, userMessage];
    const chatTitle = activeChat.title === 'New chat' ? input.trim() : activeChat.title;

    setChats(prev => prev.map(c =>
      c.id === activeChatId ? { ...c, messages: newMessages, title: chatTitle } : c
    ));
    setInput('');
    setLoading(true);

    if (textareaRef.current) textareaRef.current.style.height = 'auto';

    try {
      const data = await callApi(newMessages);
      const assistantMessage: Message = { role: 'assistant', content: data.explanation, manimCode: data.manimCode };

      setChats(prev => prev.map(c =>
        c.id === activeChatIdRef.current
          ? { ...c, messages: [...c.messages, assistantMessage] }
          : c
      ));
      showAnimation(data.manimCode, userMessage.content);
    } catch (err) {
      console.error(err);
      setChats(prev => prev.map(c =>
        c.id === activeChatIdRef.current
          ? { ...c, messages: [...c.messages, { role: 'assistant', content: 'Something went wrong. Please try again.' }] }
          : c
      ));
    } finally {
      setLoading(false);
    }
  }

  async function retryLastMessage() {
    if (loading || !activeChat) return;
    const lastUserIdx = activeChat.messages.reduce((last, m, i) => m.role === 'user' ? i : last, -1);
    if (lastUserIdx === -1) return;

    const trimmed = activeChat.messages.slice(0, lastUserIdx + 1);
    lastUserLabelRef.current = trimmed[lastUserIdx].content;
    hasRetriedRef.current = false;

    setChats(prev => prev.map(c => c.id === activeChatId ? { ...c, messages: trimmed } : c));
    setLoading(true);

    try {
      const data = await callApi(trimmed);
      const assistantMessage: Message = { role: 'assistant', content: data.explanation, manimCode: data.manimCode };

      setChats(prev => prev.map(c =>
        c.id === activeChatIdRef.current
          ? { ...c, messages: [...c.messages, assistantMessage] }
          : c
      ));
      showAnimation(data.manimCode, trimmed[lastUserIdx].content);
    } catch (err) {
      console.error(err);
      setChats(prev => prev.map(c =>
        c.id === activeChatIdRef.current
          ? { ...c, messages: [...c.messages, { role: 'assistant', content: 'Something went wrong. Please try again.' }] }
          : c
      ));
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  function handleInput(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
  }

  const hasAnimation = Boolean(activeChat?.currentCode);
  const isEmpty = (activeChat?.messages.length ?? 0) === 0;

  const hasLastAssistant =
    (activeChat?.messages.length ?? 0) > 0 &&
    activeChat?.messages[activeChat.messages.length - 1].role === 'assistant';

  function chooseSuggestion(prompt: string) {
    setInput(prompt);
    requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      textarea.style.height = 'auto';
      textarea.style.height = Math.min(textarea.scrollHeight, 160) + 'px';
      textarea.focus();
    });
  }

  return (
    <div className="chat-layout flex h-dvh overflow-hidden bg-background text-foreground">
      <WorkspaceHistory label="chat" items={chats} activeId={activeChatId} disabled={loading} onNew={newChat} onSelect={switchChat} onDelete={deleteChat} />
      <main aria-label="Chat" className={`chat-pane flex min-h-0 min-w-0 flex-col ${hasAnimation ? 'chat-pane--split shrink-0 border-r border-border bg-card' : 'flex-1 bg-background'}`}>
        <header className="flex h-[72px] shrink-0 items-center gap-2.5 border-b border-border px-3">
          <MathLogo size={30} />
          <div><h1 className="text-2xl font-bold leading-tight tracking-tight">veomath</h1><p className="text-sm text-muted-foreground">Understand math visually</p></div>
        </header>
        <div className={`min-h-0 flex-1 ${hasAnimation ? 'flex flex-col' : 'overflow-y-auto'}`}>
          <div className={`chat-conversation ${hasAnimation ? 'flex min-h-0 flex-1 flex-col' : 'chat-conversation--centered'}`}>
            {!hasAnimation && isEmpty && <h2 className="mb-4 text-center text-2xl">What are you curious about?</h2>}
            <div className={hasAnimation ? 'min-h-0 flex-1 overflow-y-auto p-3' : 'max-h-[45dvh] overflow-y-auto'} aria-live="polite" aria-busy={loading}>
              <div className="space-y-3">
                {(activeChat?.messages ?? []).map((message, index) => <div key={index} className={`flex flex-col ${message.role === 'user' ? 'items-end' : 'items-start'}`}>
                  <span className="mb-1 text-sm text-muted-foreground">{message.role === 'user' ? 'You' : 'veomath'}</span>
                  <Card className={`max-w-[95%] shadow-none ${message.role === 'user' ? 'border-input bg-secondary' : 'border-border bg-background'}`}>
                    <CardContent className="whitespace-pre-wrap px-3 py-2 text-base leading-relaxed">{message.content}</CardContent>
                  </Card>
                  {message.role === 'assistant' && message.manimCode && <Button variant="ghost" size="sm" className="mt-0.5 text-muted-foreground" onClick={() => showAnimation(message.manimCode!)}><RotateCcw />Replay animation</Button>}
                </div>)}
                {loading && <div role="status" className="rounded-lg border border-border bg-card px-3 py-2 text-base text-muted-foreground"><span className="thinking-dots">{isAutoRetrying ? 'Fixing the animation' : 'Thinking it through'}</span></div>}
              </div>
              <div ref={messagesEndRef} />
            </div>
            {!loading && <div className={hasAnimation ? 'shrink-0 border-t border-border p-2.5' : isEmpty ? '' : 'mt-3'}>
              {hasLastAssistant && <div className="mb-1 flex justify-end"><Button variant="ghost" size="sm" onClick={retryLastMessage}><RotateCcw />Regenerate</Button></div>}
              <div className="chat-composer flex items-center gap-2 rounded-xl border border-input bg-secondary px-2 py-2 focus-within:ring-1 focus-within:ring-ring">
                <Textarea ref={textareaRef} aria-label="Ask a math question" value={input} onChange={handleInput} onKeyDown={handleKeyDown} placeholder={PROMPT_EXAMPLES[promptIndex]} rows={2} className={`flex-1 resize-none border-0 bg-transparent px-2 py-2 shadow-none focus-visible:ring-0 ${hasAnimation ? 'min-h-[60px]' : 'min-h-[80px]'}`} />
                <Button size="icon" aria-label="Send message" title="Send message" onClick={sendMessage} disabled={!input.trim()} className="size-10 shrink-0 self-center"><ArrowUp /></Button>
              </div>
            </div>}
            {!hasAnimation && isEmpty && <PromptSuggestions onSelect={chooseSuggestion} disabled={loading} />}
          </div>
        </div>
      </main>
      {hasAnimation && <section aria-label="Visualization" className="chat-visualization relative min-w-0 flex-1 overflow-hidden bg-background">
        {activeChat?.currentCode && <ManimRenderer code={activeChat.currentCode} renderKey={renderKey} activitySessionId={activeChat.id} onError={handleRenderError} onSuccess={handleRenderSuccess} onRuntimeError={handleRuntimeError} onReady={handleReady} />}
        {activeChat?.currentCode && <div className="absolute left-3 top-3 z-30 flex items-center gap-2">
          <Button variant="outline" size="sm" aria-pressed={showCodePanel} onClick={() => setShowCodePanel(value => !value)}><Code2 />{showCodePanel ? 'Hide code' : 'View code'}</Button>
          {runtimeError && <Badge variant="destructive" className="max-w-64 truncate" title={runtimeError}>Runtime error</Badge>}
        </div>}
        {showCodePanel && activeChat?.currentCode && <Card className="absolute inset-y-14 right-3 z-30 flex w-[min(460px,calc(100%-32px))] flex-col overflow-hidden shadow-xl">
          <div className="flex items-center justify-between border-b border-border px-3 py-2"><span className="text-base">Generated code</span><div className="flex gap-1"><Button variant="ghost" size="icon" aria-label="Copy code" onClick={() => navigator.clipboard.writeText(activeChat.currentCode!)}><Copy /></Button><Button variant="ghost" size="icon" aria-label="Close code panel" onClick={() => setShowCodePanel(false)}><X /></Button></div></div>
          {runtimeError && <Alert variant="destructive" className="rounded-none border-x-0"><AlertTitle>Runtime error</AlertTitle><AlertDescription className="break-words">{runtimeError}</AlertDescription></Alert>}
          <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words p-3 text-sm leading-relaxed">{activeChat.currentCode}</pre>
          {manimExports.length > 0 && <details className="border-t border-border p-3 text-sm text-muted-foreground"><summary className="cursor-pointer">Available exports ({manimExports.length})</summary><p className="mt-2 max-h-32 overflow-y-auto break-words">{manimExports.join(', ')}</p></details>}
        </Card>}
        {(activeChat?.animationHistory.length ?? 0) > 0 && <div className={`absolute bottom-3 right-3 z-20 max-w-[80%] ${debugInfo ? 'bottom-64' : ''}`}>
          <p className="mb-2 text-right text-sm text-muted-foreground">Animation history</p>
          <div className="flex flex-wrap justify-end gap-2">{activeChat?.animationHistory.map((item, index) => <Button key={index} variant={activeChat.currentCode === item.code ? 'secondary' : 'outline'} size="sm" title={item.label} className="max-w-48" onClick={() => showAnimation(item.code)}><span className="truncate">{item.label}</span></Button>)}</div>
        </div>}
        {debugInfo && <Card className="absolute inset-x-3 bottom-3 z-30 max-h-60 overflow-y-auto border-destructive shadow-xl">
          <div className="flex items-center justify-between border-b border-border px-3 py-2"><span className="text-base text-destructive">Render error{hasRetriedRef.current ? ' · auto-fix attempted' : ''}</span><Button variant="ghost" size="icon" aria-label="Dismiss error" onClick={() => setDebugInfo(null)}><X /></Button></div>
          <pre className="whitespace-pre-wrap break-words p-3 text-sm text-destructive">{debugInfo.error}</pre>
          <details className="px-3 pb-3 text-sm"><summary className="cursor-pointer text-muted-foreground">Generated code</summary><pre className="mt-2 whitespace-pre-wrap break-words">{debugInfo.code}</pre></details>
        </Card>}
      </section>}
    </div>
  );
}
