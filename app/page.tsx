'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import MathLogo from './components/MathLogo';
import { apiFetch, responseError } from './lib/api-fetch';
import { auth } from './lib/firebase-client';

const ManimRenderer = dynamic(() => import('./components/ManimRenderer'), { ssr: false });

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

function formatDate(ts: number) {
  const diff = Date.now() - ts;
  const d = new Date(ts);
  if (diff < 86400000) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (diff < 604800000) return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export default function Home() {
  const [chats, setChats] = useState<Chat[]>([]);
  const [activeChatId, setActiveChatId] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [isAutoRetrying, setIsAutoRetrying] = useState(false);
  const [debugInfo, setDebugInfo] = useState<DebugInfo | null>(null);
  const [input, setInput] = useState('');
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

  const hasLastAssistant =
    (activeChat?.messages.length ?? 0) > 0 &&
    activeChat?.messages[activeChat.messages.length - 1].role === 'assistant';

  const debugPanelHeight = 220;

  return (
    <div className="flex h-screen" style={{ background: '#0a0a0a', color: 'var(--foreground)' }}>

      {/* Sidebar: Chat history */}
      <div
        style={{
          width: sidebarOpen ? '220px' : '48px',
          minWidth: sidebarOpen ? '220px' : '48px',
          borderRight: '1px solid var(--border)',
          background: '#0d0d0d',
          display: 'flex',
          flexDirection: 'column',
          transition: 'width 0.2s, min-width 0.2s',
          overflow: 'hidden',
          flexShrink: 0,
        }}
      >
        {/* Sidebar header row */}
        <div
          style={{
            padding: '12px 8px',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            borderBottom: '1px solid var(--border)',
            flexShrink: 0,
          }}
        >
          <button
            onClick={() => setSidebarOpen(o => !o)}
            title={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--muted-foreground)',
              cursor: 'pointer',
              padding: '4px',
              borderRadius: '6px',
              flexShrink: 0,
              lineHeight: 1,
              fontSize: '14px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '28px',
              height: '28px',
            }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--secondary-foreground)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--muted-foreground)')}
          >
            {sidebarOpen ? '⟨' : '⟩'}
          </button>

          {sidebarOpen && (
            <button
              onClick={newChat}
              title="New chat"
              style={{
                background: 'none',
              border: '1px solid var(--input)',
              borderRadius: '6px',
              color: 'var(--secondary-foreground)',
              fontSize: '11px',
              cursor: 'pointer',
              padding: '4px 10px',
              marginLeft: 'auto',
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
            onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--border-hover)')}
            onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--input)')}
            >
              + New
            </button>
          )}
        </div>

        {/* New chat icon when collapsed */}
        {!sidebarOpen && (
          <div style={{ padding: '6px', display: 'flex', justifyContent: 'center' }}>
            <button
              onClick={newChat}
              title="New chat"
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--muted-foreground)',
                cursor: 'pointer',
                padding: '4px',
                fontSize: '16px',
                lineHeight: 1,
                width: '28px',
                height: '28px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              onMouseEnter={e => (e.currentTarget.style.color = 'var(--secondary-foreground)')}
              onMouseLeave={e => (e.currentTarget.style.color = 'var(--muted-foreground)')}
            >
              +
            </button>
          </div>
        )}

        {/* Chat list */}
        {sidebarOpen && (
          <div style={{ flex: 1, overflowY: 'auto', padding: '6px' }}>
            {chats.map(chat => (
              <button
                key={chat.id}
                onClick={() => switchChat(chat.id)}
                style={{
                  width: '100%',
                  background: chat.id === activeChatId ? '#1a1a1a' : 'none',
                  border: 'none',
                  borderRadius: '6px',
                  padding: '7px 8px',
                  color: chat.id === activeChatId ? 'var(--foreground)' : 'var(--muted-foreground)',
                  fontSize: '12px',
                  cursor: 'pointer',
                  textAlign: 'left',
                  display: 'flex',
                  alignItems: 'flex-start',
                  justifyContent: 'space-between',
                  marginBottom: '2px',
                  position: 'relative',
                }}
                title={chat.title}
                onMouseEnter={e => {
                  if (chat.id !== activeChatId) e.currentTarget.style.background = '#141414';
                  const del = e.currentTarget.querySelector('[data-delete]') as HTMLElement;
                  if (del) del.style.opacity = '1';
                }}
                onMouseLeave={e => {
                  if (chat.id !== activeChatId) e.currentTarget.style.background = 'none';
                  const del = e.currentTarget.querySelector('[data-delete]') as HTMLElement;
                  if (del) del.style.opacity = '0';
                }}
              >
                <div style={{ overflow: 'hidden', flex: 1, minWidth: 0 }}>
                  <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {chat.title}
                  </div>
                  <div style={{ fontSize: '10px', color: 'var(--muted-foreground)', marginTop: '2px' }}>
                    {formatDate(chat.createdAt)}
                  </div>
                </div>
                <span
                  data-delete
                  onClick={e => { e.stopPropagation(); deleteChat(chat.id); }}
                  title="Delete chat"
                  style={{
                  opacity: 0,
                  color: 'var(--muted-foreground)',
                  fontSize: '14px',
                  cursor: 'pointer',
                  padding: '0 2px',
                  lineHeight: 1,
                  flexShrink: 0,
                  transition: 'opacity 0.1s',
                }}
                onMouseEnter={e => (e.currentTarget.style.color = '#ef4444')}
                onMouseLeave={e => (e.currentTarget.style.color = 'var(--muted-foreground)')}
                >
                  ×
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Center: Chat panel */}
      <div
        className="flex flex-col"
        style={{
          width: '380px',
          minWidth: '320px',
          borderRight: '1px solid #333',
          background: '#111111',
          flexShrink: 0,
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid #333',
            fontSize: '15px',
            fontWeight: 600,
            letterSpacing: '-0.01em',
            color: 'var(--foreground)',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
          }}
        >
          <MathLogo />
          veomath
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto" style={{ padding: '16px' }}>
          {(!activeChat || activeChat.messages.length === 0) && !loading && (
            <div
              style={{
                color: 'var(--muted-foreground)',
                fontSize: '13px',
                textAlign: 'center',
                marginTop: '40px',
                lineHeight: 1.6,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '24px',
              }}
            >
              <div>
                Ask me to visualize any math concept.
                <br />
                Try &ldquo;Show me the Pythagorean theorem&rdquo;
                <br />
                or &ldquo;Animate the unit circle&rdquo;.
              </div>
              <Link
                href="/agentic"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  background: '#1a1a1a',
                  border: '1px solid var(--input)',
                  borderRadius: '12px',
                  padding: '12px 20px',
                  color: 'var(--foreground)',
                  fontSize: '13px',
                  cursor: 'pointer',
                  textDecoration: 'none',
                  transition: 'all 0.2s',
                  boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--border-hover)'; e.currentTarget.style.background = '#252525'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--input)'; e.currentTarget.style.background = '#1a1a1a'; }}
              >
                ✨ Create a coherent storyline of animations
              </Link>
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {(activeChat?.messages ?? []).map((m, i) => (
              <div
                key={i}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: m.role === 'user' ? 'flex-end' : 'flex-start',
                }}
              >
                <div
                  style={{
                    maxWidth: '88%',
                    padding: '8px 12px',
                    borderRadius: m.role === 'user' ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
                    background: m.role === 'user' ? '#2563eb' : '#232323',
                    color: m.role === 'user' ? '#fff' : 'var(--foreground)',
                    fontSize: '13px',
                    lineHeight: 1.55,
                  }}
                >
                  {m.content}
                </div>
                {m.role === 'assistant' && m.manimCode && (
                  <button
                    onClick={() => showAnimation(m.manimCode!)}
                    style={{
                      marginTop: '4px',
                      background: 'none',
                      border: 'none',
                      color: 'var(--muted-foreground)',
                      fontSize: '11px',
                      cursor: 'pointer',
                      padding: '2px 4px',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.color = 'var(--secondary-foreground)')}
                    onMouseLeave={e => (e.currentTarget.style.color = 'var(--muted-foreground)')}
                  >
                    replay animation
                  </button>
                )}
              </div>
            ))}

            {loading && (
              <div style={{ display: 'flex', alignItems: 'flex-start' }}>
                <div
                  style={{
                    padding: '8px 12px',
                    borderRadius: '14px 14px 14px 4px',
                    background: '#232323',
                    fontSize: '13px',
                    color: 'var(--muted-foreground)',
                  }}
                >
                  <span className="thinking-dots">
                    {isAutoRetrying ? 'fixing error' : 'thinking'}
                  </span>
                </div>
              </div>
            )}
          </div>

          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
          <div style={{ padding: '12px 16px', borderTop: '1px solid #333' }}>
          {hasLastAssistant && !loading && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '6px' }}>
              <button
                onClick={retryLastMessage}
                style={{
                  background: 'none',
                border: '1px solid var(--input)',
                borderRadius: '8px',
                padding: '3px 10px',
                color: 'var(--muted-foreground)',
                fontSize: '11px',
                cursor: 'pointer',
              }}
              onMouseEnter={e => (e.currentTarget.style.color = 'var(--secondary-foreground)')}
              onMouseLeave={e => (e.currentTarget.style.color = 'var(--muted-foreground)')}
              >
                regenerate
              </button>
            </div>
          )}
          <div
            style={{
              display: 'flex',
              gap: '8px',
              alignItems: 'flex-end',
              background: '#1a1a1a',
              borderRadius: '12px',
              padding: '8px 12px',
              border: '1px solid var(--input)',
            }}
          >
            <textarea
              ref={textareaRef}
              value={input}
              onChange={handleInput}
              onKeyDown={handleKeyDown}
              placeholder="Ask about a math concept..."
              rows={1}
              disabled={loading}
              style={{
                flex: 1,
                background: 'none',
                border: 'none',
                outline: 'none',
                color: 'var(--foreground)',
                fontSize: '13px',
                lineHeight: '1.5',
                resize: 'none',
                fontFamily: 'inherit',
              }}
            />
            <button
              onClick={sendMessage}
              disabled={loading || !input.trim()}
              style={{
                background: input.trim() && !loading ? '#2563eb' : '#2e2e2e',
                color: input.trim() && !loading ? '#fff' : 'var(--muted-foreground)',
                border: 'none',
                borderRadius: '8px',
                padding: '5px 12px',
                fontSize: '12px',
                cursor: input.trim() && !loading ? 'pointer' : 'default',
                transition: 'background 0.15s',
                flexShrink: 0,
              }}
            >
              Send
            </button>
          </div>
          <div style={{ fontSize: '10px', color: 'var(--muted-foreground)', marginTop: '6px', textAlign: 'center' }}>
            Enter to send &middot; Shift+Enter for newline
          </div>
        </div>
      </div>

      {/* Right: Manim renderer */}
      <div className="flex-1 relative" style={{ background: '#000', overflow: 'hidden' }}>
        {activeChat?.currentCode ? (
          <ManimRenderer
            code={activeChat.currentCode}
            renderKey={renderKey}
            activitySessionId={activeChat.id}
            onError={handleRenderError}
            onSuccess={handleRenderSuccess}
            onRuntimeError={handleRuntimeError}
            onReady={handleReady}
          />
        ) : (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--muted-foreground)',
              fontSize: '13px',
            }}
          >
            Animation will appear here
          </div>
        )}

        {/* Code viewer toggle — top right */}
        {activeChat?.currentCode && (
          <div style={{ position: 'absolute', top: 12, right: 12, zIndex: 30, display: 'flex', gap: '6px', alignItems: 'center' }}>
            {runtimeError && (
              <div
                title={runtimeError}
                style={{
                  background: '#1a0a0a',
                  border: '1px solid #7f1d1d',
                  borderRadius: '8px',
                  padding: '3px 10px',
                  color: '#f87171',
                  fontSize: '11px',
                  maxWidth: '260px',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  cursor: 'default',
                }}
              >
                ⚠ {runtimeError}
              </div>
            )}
            <button
              onClick={() => setShowCodePanel(o => !o)}
              title={showCodePanel ? 'Hide code' : 'View generated code'}
              style={{
              background: showCodePanel ? '#1e3a5f' : '#111',
              border: `1px solid ${showCodePanel ? '#2563eb' : 'var(--input)'}`,
              borderRadius: '8px',
              padding: '3px 10px',
              color: showCodePanel ? '#93c5fd' : 'var(--muted-foreground)',
              fontSize: '11px',
              cursor: 'pointer',
              fontFamily: 'monospace',
            }}
            onMouseEnter={e => { if (!showCodePanel) e.currentTarget.style.borderColor = 'var(--border-hover)'; }}
            onMouseLeave={e => { if (!showCodePanel) e.currentTarget.style.borderColor = 'var(--input)'; }}
            >
              {'{ }'}
            </button>
          </div>
        )}

        {/* Code viewer panel */}
        {showCodePanel && activeChat?.currentCode && (
          <div
            style={{
              position: 'absolute',
              top: 0,
              right: 0,
              bottom: debugInfo ? debugPanelHeight : 0,
              width: '420px',
              background: '#0a0a0a',
              borderLeft: '1px solid #2d2d2d',
              display: 'flex',
              flexDirection: 'column',
              zIndex: 25,
            }}
          >
            <div
              style={{
                padding: '8px 12px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              borderBottom: '1px solid #2d2d2d',
              flexShrink: 0,
            }}
          >
              <span style={{ fontSize: '11px', color: 'var(--muted-foreground)', fontFamily: 'monospace' }}>
                generated code
                {manimExports.length > 0 && (
                  <span style={{ marginLeft: '8px', color: manimExports.includes('makeDraggable') ? '#4ade80' : '#f87171' }}>
                    · makeDraggable: {manimExports.includes('makeDraggable') ? '✓' : '✗'}
                  </span>
                )}
              </span>
              <div style={{ display: 'flex', gap: '6px' }}>
                <button
                  onClick={() => navigator.clipboard.writeText(activeChat.currentCode!)}
                  style={{
                    background: 'none',
                    border: '1px solid var(--input)',
                    borderRadius: '6px',
                    padding: '2px 8px',
                    color: 'var(--muted-foreground)',
                    fontSize: '10px',
                    cursor: 'pointer',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.color = 'var(--secondary-foreground)')}
                  onMouseLeave={e => (e.currentTarget.style.color = 'var(--muted-foreground)')}
                >
                  copy
                </button>
                <button
                  onClick={() => setShowCodePanel(false)}
                  style={{ background: 'none', border: 'none', color: 'var(--muted-foreground)', fontSize: '14px', cursor: 'pointer', lineHeight: 1, padding: '0 2px' }}
                >
                  ×
                </button>
              </div>
            </div>
            {runtimeError && (
              <div style={{ padding: '8px 12px', background: '#1a0a0a', borderBottom: '1px solid #7f1d1d', flexShrink: 0 }}>
                <div style={{ fontSize: '10px', color: '#f87171', fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
                  ⚠ Runtime error (in updater/loop):{'\n'}{runtimeError}
                </div>
              </div>
            )}
            <div style={{ flex: 1, overflowY: 'auto', padding: '12px' }}>
              <pre style={{ color: 'var(--muted-foreground)', fontSize: '11px', margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'monospace', lineHeight: 1.6 }}>
                {activeChat.currentCode}
              </pre>
            </div>
          </div>
        )}

        {/* Animation history — bottom right */}
        {(activeChat?.animationHistory.length ?? 0) > 0 && (
          <div
            style={{
              position: 'absolute',
              bottom: debugInfo ? debugPanelHeight + 12 : 12,
              right: 12,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-end',
              gap: '4px',
              zIndex: 20,
              transition: 'bottom 0.2s',
            }}
          >
            <div style={{ fontSize: '10px', color: 'var(--muted-foreground)', marginBottom: '2px' }}>history</div>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', justifyContent: 'flex-end', maxWidth: '320px' }}>
              {(activeChat?.animationHistory ?? []).map((item, i) => (
                <button
                  key={i}
                  onClick={() => showAnimation(item.code)}
                  style={{
                    background: activeChat?.currentCode === item.code ? '#2563eb' : '#111',
                    border: `1px solid ${activeChat?.currentCode === item.code ? '#2563eb' : 'var(--input)'}`,
                    borderRadius: '12px',
                    padding: '3px 10px',
                    color: activeChat?.currentCode === item.code ? '#fff' : 'var(--muted-foreground)',
                    fontSize: '11px',
                    cursor: 'pointer',
                    maxWidth: '140px',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  title={item.label}
                >
                  {item.label.length > 22 ? item.label.slice(0, 22) + '…' : item.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Debug panel — bottom */}
        {debugInfo && (
          <div
            style={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              right: 0,
              height: debugPanelHeight,
              background: '#0d0d0d',
              borderTop: '1px solid #ef4444',
              display: 'flex',
              flexDirection: 'column',
              zIndex: 10,
            }}
          >
            <div
              style={{
                padding: '6px 12px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              borderBottom: '1px solid #2d2d2d',
              flexShrink: 0,
            }}
          >
              <span style={{ color: '#ef4444', fontSize: '11px', fontWeight: 600 }}>
                Render Error{hasRetriedRef.current ? ' — auto-fix attempted' : ''}
              </span>
                <button
                onClick={() => setDebugInfo(null)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--muted-foreground)',
                  fontSize: '14px',
                  cursor: 'pointer',
                  lineHeight: 1,
                  padding: '0 2px',
                }}
              >
                ×
              </button>
            </div>
            <div style={{ overflow: 'auto', flex: 1, padding: '10px 12px', display: 'flex', gap: '12px' }}>
              <div style={{ flex: '0 0 40%' }}>
                <div style={{ fontSize: '10px', color: 'var(--muted-foreground)', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Error</div>
                <pre style={{ color: '#ef4444', fontSize: '11px', margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}>
                  {debugInfo.error}
                </pre>
              </div>
              <div style={{ flex: 1, borderLeft: '1px solid #2d2d2d', paddingLeft: '12px' }}>
                <div style={{ fontSize: '10px', color: 'var(--muted-foreground)', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Generated code</div>
                <pre style={{ color: 'var(--muted-foreground)', fontSize: '11px', margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}>
                  {debugInfo.code}
                </pre>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
