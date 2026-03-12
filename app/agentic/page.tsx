'use client';

import React, { useState, useRef, useEffect, useCallback, Component } from 'react';
import dynamic from 'next/dynamic';

const ManimRenderer = dynamic(() => import('../components/ManimRenderer'), { ssr: false });

class SlideErrorBoundary extends Component<
  { children: React.ReactNode; onError: (error: string) => void },
  { hasError: boolean; errorMsg: string }
> {
  constructor(props: { children: React.ReactNode; onError: (error: string) => void }) {
    super(props);
    this.state = { hasError: false, errorMsg: '' };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, errorMsg: String(error) };
  }

  componentDidCatch(error: Error) {
    this.props.onError(String(error));
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ color: '#f87171', padding: '16px', fontFamily: 'monospace', fontSize: '12px', whiteSpace: 'pre-wrap' }}>
          {this.state.errorMsg}
        </div>
      );
    }
    return this.props.children;
  }
}

type Phase = 'input' | 'planning' | 'plan-ready' | 'generating' | 'ready';

type SlideProgress = {
  stage: string;
  message: string;
};

type PlanItem =
  | { type: 'text'; content: string; title: ''; description: '' }
  | { type: 'slide'; content: ''; title: string; description: string };

type DocTextItem = { type: 'text'; content: string };
type DocSlideItem = {
  type: 'slide';
  title: string;
  description: string;
  manimCode: string;
  renderKey: number;
  error: string | null;
  comment: string;
  isRegenerating: boolean;
  hasAutoRetried: boolean;
  codeHistory: string[];
};
type DocPlaceholderItem = { type: 'placeholder'; planType: 'text' | 'slide'; title: string; description: string };
type DocItem = DocTextItem | DocSlideItem | DocPlaceholderItem;

type Session = {
  id: string;
  topic: string;
  sessionTitle: string;
  planItems: PlanItem[];
  userComments: string;
  docItems: DocItem[];
  phase: Phase;
  createdAt: number;
};

function createSession(): Session {
  return {
    id: crypto.randomUUID(),
    topic: '',
    sessionTitle: 'New explainer',
    planItems: [],
    userComments: '',
    docItems: [],
    phase: 'input',
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

export default function AgenticPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [input, setInput] = useState('');
  const [planComments, setPlanComments] = useState('');
  const [planSlideComments, setPlanSlideComments] = useState<Map<number, string>>(new Map());
  const [courseRegenerateFeedback, setCourseRegenerateFeedback] = useState('');
  const [isRegeneratingCourse, setIsRegeneratingCourse] = useState(false);

  const [slideProgress, setSlideProgress] = useState<Map<number, SlideProgress>>(new Map());
  const [globalProgress, setGlobalProgress] = useState('');

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const activeSessionIdRef = useRef('');
  const sessionsRef = useRef<Session[]>([]);
  const slideRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const slideFramesRef = useRef<Map<number, string>>(new Map());

  useEffect(() => { activeSessionIdRef.current = activeSessionId; }, [activeSessionId]);
  useEffect(() => { sessionsRef.current = sessions; }, [sessions]);

  useEffect(() => {
    const saved = localStorage.getItem('veomath-agentic-sessions');
    if (saved) {
      try {
        const parsed: Session[] = JSON.parse(saved);
        if (parsed.length > 0) {
          setSessions(parsed);
          setActiveSessionId(parsed[0].id);
          activeSessionIdRef.current = parsed[0].id;
          return;
        }
      } catch { }
    }
    const fresh = createSession();
    setSessions([fresh]);
    setActiveSessionId(fresh.id);
    activeSessionIdRef.current = fresh.id;
  }, []);

  useEffect(() => {
    if (sessions.length > 0) {
      localStorage.setItem('veomath-agentic-sessions', JSON.stringify(sessions));
    }
  }, [sessions]);

  const activeSession = sessions.find(s => s.id === activeSessionId) ?? null;

  const updateSession = useCallback((id: string, update: Partial<Session>) => {
    setSessions(prev => prev.map(s => s.id === id ? { ...s, ...update } : s));
  }, []);

  const updateDocItem = useCallback((sessionId: string, itemIndex: number, update: Partial<DocSlideItem>) => {
    setSessions(prev => prev.map(s => {
      if (s.id !== sessionId) return s;
      const newItems = [...s.docItems];
      const item = newItems[itemIndex];
      if (item.type === 'slide') {
        newItems[itemIndex] = { ...item, ...update };
      }
      return { ...s, docItems: newItems };
    }));
  }, []);

  function newSession() {
    const session = createSession();
    setSessions(prev => [session, ...prev]);
    setActiveSessionId(session.id);
    activeSessionIdRef.current = session.id;
    setInput('');
    setPlanComments('');
    setPlanSlideComments(new Map());
  }

  function switchSession(id: string) {
    if (id === activeSessionId) return;
    const s = sessions.find(x => x.id === id);
    if (!s) return;
    setActiveSessionId(id);
    activeSessionIdRef.current = id;
    setInput('');
    setPlanComments(s.userComments);
  }

  function deleteSession(id: string) {
    setSessions(prev => {
      const remaining = prev.filter(s => s.id !== id);
      if (remaining.length === 0) {
        const fresh = createSession();
        setActiveSessionId(fresh.id);
        activeSessionIdRef.current = fresh.id;
        return [fresh];
      }
      if (id === activeSessionIdRef.current) {
        const idx = prev.findIndex(s => s.id === id);
        const next = remaining[Math.min(idx, remaining.length - 1)];
        setActiveSessionId(next.id);
        activeSessionIdRef.current = next.id;
      }
      return remaining;
    });
    setInput('');
    setPlanComments('');
    setPlanSlideComments(new Map());
  }

  async function submitTopic() {
    if (!input.trim() || !activeSession) return;
    const topic = input.trim();
    const title = activeSession.sessionTitle === 'New explainer' ? topic : activeSession.sessionTitle;

    updateSession(activeSessionId, { topic, sessionTitle: title, phase: 'planning' });
    setInput('');

    try {
      const res = await fetch('/api/agentic', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'plan', topic }),
      });
      if (!res.ok) throw new Error('API error');
      const data = await res.json();

      updateSession(activeSessionIdRef.current, {
        sessionTitle: data.sessionTitle || title,
        planItems: data.items,
        phase: 'plan-ready',
      });
    } catch (err) {
      console.error(err);
      updateSession(activeSessionIdRef.current, { phase: 'input' });
    }
  }

  async function streamGenerationResponse(
    res: Response,
    planItems: PlanItem[],
    onDone?: () => void,
  ) {
    const reader = res.body?.getReader();
    if (!reader) throw new Error('No reader');

    const decoder = new TextDecoder();
    let buffer = '';
    const itemsByIndex = new Map<number, DocItem>();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);

          if (event.type === 'progress') {
            if (event.slideIndex !== undefined) {
              setSlideProgress(prev => {
                const next = new Map(prev);
                next.set(event.slideIndex, { stage: event.stage, message: event.message });
                return next;
              });
            }
            setGlobalProgress(event.message);
          } else if (event.type === 'item') {
            const planItem = planItems[event.index];

            if (event.item.type === 'text') {
              itemsByIndex.set(event.index, { type: 'text' as const, content: event.item.content });
            } else {
              const desc = planItem?.type === 'slide' ? planItem.description : '';
              itemsByIndex.set(event.index, {
                type: 'slide' as const,
                title: event.item.title,
                description: desc,
                manimCode: event.item.manimCode,
                renderKey: 0,
                error: null,
                comment: '',
                isRegenerating: false,
                hasAutoRetried: false,
                codeHistory: [event.item.manimCode],
              });
            }

            const docItems: DocItem[] = planItems.map((pi, i) => {
              const real = itemsByIndex.get(i);
              if (real) return real;
              return {
                type: 'placeholder' as const,
                planType: pi.type as 'text' | 'slide',
                title: pi.type === 'slide' ? pi.title : '',
                description: pi.type === 'slide' ? pi.description : '',
              };
            });
            updateSession(activeSessionIdRef.current, { docItems });
          } else if (event.type === 'done') {
            setGlobalProgress('');
            setSlideProgress(new Map());
            const docItems: DocItem[] = [];
            for (let i = 0; i < planItems.length; i++) {
              const item = itemsByIndex.get(i);
              if (item) docItems.push(item);
            }
            updateSession(activeSessionIdRef.current, { docItems, phase: 'ready' });
            onDone?.();
          } else if (event.type === 'error') {
            console.error('Stream error:', event.message);
            setGlobalProgress(`Error: ${event.message}`);
          }
        } catch {}
      }
    }

    const finalItems: DocItem[] = [];
    for (let i = 0; i < planItems.length; i++) {
      const item = itemsByIndex.get(i);
      if (item) finalItems.push(item);
    }
    if (finalItems.length > 0) {
      updateSession(activeSessionIdRef.current, { docItems: finalItems, phase: 'ready' });
    }
    setGlobalProgress('');
    setSlideProgress(new Map());
  }

  async function proceedToGenerate() {
    if (!activeSession) return;

    const placeholders: DocItem[] = activeSession.planItems.map(item => ({
      type: 'placeholder' as const,
      planType: item.type as 'text' | 'slide',
      title: item.type === 'slide' ? item.title : '',
      description: item.type === 'slide' ? item.description : '',
    }));

    updateSession(activeSessionId, { userComments: planComments, phase: 'generating', docItems: placeholders });
    setSlideProgress(new Map());
    setGlobalProgress('Starting generation...');

    try {
      const res = await fetch('/api/agentic', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'generate',
          topic: activeSession.topic,
          items: activeSession.planItems,
          userComments: planComments,
          slideComments: Object.fromEntries(planSlideComments),
        }),
      });
      if (!res.ok) throw new Error('API error');

      await streamGenerationResponse(res, activeSession.planItems);
    } catch (err) {
      console.error(err);
      updateSession(activeSessionIdRef.current, { phase: 'plan-ready' });
      setGlobalProgress('');
      setSlideProgress(new Map());
    }
  }

  async function regenerateCourse() {
    if (!activeSession || isRegeneratingCourse) return;
    setIsRegeneratingCourse(true);

    const lessonContext = activeSession.docItems
      .filter(item => item.type !== 'placeholder')
      .map(item => {
        if (item.type === 'text') return { type: 'text', content: item.content };
        return { type: 'slide', title: item.title, description: item.description, manimCode: item.manimCode, comment: item.comment };
      });

    const placeholders: DocItem[] = activeSession.planItems.map(item => ({
      type: 'placeholder' as const,
      planType: item.type as 'text' | 'slide',
      title: item.type === 'slide' ? item.title : '',
      description: item.type === 'slide' ? item.description : '',
    }));

    updateSession(activeSessionId, { phase: 'generating', docItems: placeholders });
    setSlideProgress(new Map());
    setGlobalProgress('Regenerating course...');

    try {
      const res = await fetch('/api/agentic', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'regenerate-course',
          topic: activeSession.topic,
          items: activeSession.planItems,
          lessonContext,
          overallFeedback: courseRegenerateFeedback,
        }),
      });
      if (!res.ok) throw new Error('API error');

      await streamGenerationResponse(res, activeSession.planItems, () => {
        setCourseRegenerateFeedback('');
      });
    } catch (err) {
      console.error(err);
      updateSession(activeSessionIdRef.current, { phase: 'ready' });
      setGlobalProgress('');
      setSlideProgress(new Map());
    } finally {
      setIsRegeneratingCourse(false);
    }
  }

  const handleSlideError = useCallback(async (sessionId: string, itemIndex: number, failedCode: string, error: string) => {
    const session = sessionsRef.current.find(s => s.id === sessionId);
    if (!session) return;
    const item = session.docItems[itemIndex];
    if (item.type !== 'slide') return;

    updateDocItem(sessionId, itemIndex, { error });

    if (item.hasAutoRetried) return;
    updateDocItem(sessionId, itemIndex, { hasAutoRetried: true, isRegenerating: true });

    try {
      const surroundingText = session.docItems
        .slice(Math.max(0, itemIndex - 2), itemIndex + 3)
        .filter(i => i.type === 'text')
        .map(i => (i as DocTextItem).content)
        .join(' ');

      const res = await fetch('/api/agentic', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'regenerate-slide',
          topic: session.topic,
          slideTitle: item.title,
          slideDescription: item.description,
          userComment: '',
          sessionContext: surroundingText,
          failedCode,
          error,
          currentCode: item.manimCode,
          currentFrame: slideFramesRef.current.get(itemIndex) || null,
        }),
      });
      if (!res.ok) throw new Error('API error');
      const data: { manimCode: string } = await res.json();

      const freshSession = sessionsRef.current.find(s => s.id === sessionId);
      const freshItem = freshSession?.docItems[itemIndex];
      const prevHistory = freshItem?.type === 'slide' ? (freshItem.codeHistory || []) : [];

      updateDocItem(sessionId, itemIndex, {
        manimCode: data.manimCode,
        renderKey: item.renderKey + 1,
        error: null,
        isRegenerating: false,
        codeHistory: [...prevHistory, data.manimCode],
      });
    } catch {
      updateDocItem(sessionId, itemIndex, { isRegenerating: false });
    }
  }, [updateDocItem]);

  async function regenerateSlide(itemIndex: number) {
    if (!activeSession) return;
    const item = activeSession.docItems[itemIndex];
    if (item.type !== 'slide') return;

    updateDocItem(activeSessionId, itemIndex, { isRegenerating: true, error: null, hasAutoRetried: false });

    try {
      const surroundingText = activeSession.docItems
        .slice(Math.max(0, itemIndex - 2), itemIndex + 3)
        .filter(i => i.type === 'text')
        .map(i => (i as DocTextItem).content)
        .join(' ');

      const res = await fetch('/api/agentic', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'regenerate-slide',
          topic: activeSession.topic,
          slideTitle: item.title,
          slideDescription: item.description,
          userComment: item.comment,
          sessionContext: surroundingText,
          currentCode: item.manimCode,
          currentFrame: slideFramesRef.current.get(itemIndex) || null,
        }),
      });
      if (!res.ok) throw new Error('API error');
      const data: { manimCode: string } = await res.json();

      const freshSession = sessionsRef.current.find(s => s.id === activeSessionIdRef.current);
      const freshItem = freshSession?.docItems[itemIndex];
      const prevHistory = freshItem?.type === 'slide' ? (freshItem.codeHistory || []) : [];

      updateDocItem(activeSessionIdRef.current, itemIndex, {
        manimCode: data.manimCode,
        renderKey: item.renderKey + 1,
        error: null,
        isRegenerating: false,
        comment: '',
        codeHistory: [...prevHistory, data.manimCode],
      });
    } catch {
      updateDocItem(activeSessionIdRef.current, itemIndex, { isRegenerating: false });
    }
  }

  function scrollToSlide(itemIndex: number) {
    const el = slideRefs.current.get(itemIndex);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submitTopic();
    }
  }

  function handleInput(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
  }

  const isLoading = activeSession?.phase === 'planning' || activeSession?.phase === 'generating';

  const slideItems = (activeSession?.docItems ?? [])
    .map((item, idx) => ({ item, idx }))
    .filter(({ item }) => item.type === 'slide') as Array<{ item: DocSlideItem; idx: number }>;

  return (
    <div className="flex h-screen" style={{ background: '#0a0a0a', color: '#e5e5e5' }}>

      {/* Sidebar */}
      <div
        style={{
          width: sidebarOpen ? '220px' : '48px',
          minWidth: sidebarOpen ? '220px' : '48px',
          borderRight: '1px solid #1a1a1a',
          background: '#0d0d0d',
          display: 'flex',
          flexDirection: 'column',
          transition: 'width 0.2s, min-width 0.2s',
          overflow: 'hidden',
          flexShrink: 0,
        }}
      >
        <div
          style={{
            padding: '12px 8px',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            borderBottom: '1px solid #1a1a1a',
            flexShrink: 0,
          }}
        >
          <button
            onClick={() => setSidebarOpen(o => !o)}
            title={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
            style={{
              background: 'none',
              border: 'none',
              color: '#737373',
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
            onMouseEnter={e => (e.currentTarget.style.color = '#a3a3a3')}
            onMouseLeave={e => (e.currentTarget.style.color = '#737373')}
          >
            {sidebarOpen ? '\u27E8' : '\u27E9'}
          </button>

          {sidebarOpen && (
            <button
              onClick={newSession}
              title="New explainer"
              style={{
                background: 'none',
                border: '1px solid #2a2a2a',
                borderRadius: '6px',
                color: '#a3a3a3',
                fontSize: '11px',
                cursor: 'pointer',
                padding: '4px 10px',
                marginLeft: 'auto',
                whiteSpace: 'nowrap',
                flexShrink: 0,
              }}
              onMouseEnter={e => (e.currentTarget.style.borderColor = '#505050')}
              onMouseLeave={e => (e.currentTarget.style.borderColor = '#2a2a2a')}
            >
              + New
            </button>
          )}
        </div>

        {!sidebarOpen && (
          <div style={{ padding: '6px', display: 'flex', justifyContent: 'center' }}>
            <button
              onClick={newSession}
              title="New explainer"
              style={{
                background: 'none',
                border: 'none',
                color: '#737373',
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
              onMouseEnter={e => (e.currentTarget.style.color = '#a3a3a3')}
              onMouseLeave={e => (e.currentTarget.style.color = '#737373')}
            >
              +
            </button>
          </div>
        )}

        {sidebarOpen && (
          <div style={{ flex: 1, overflowY: 'auto', padding: '6px' }}>
            {sessions.map(session => (
              <button
                key={session.id}
                onClick={() => switchSession(session.id)}
                style={{
                  width: '100%',
                  background: session.id === activeSessionId ? '#1a1a1a' : 'none',
                  border: 'none',
                  borderRadius: '6px',
                  padding: '7px 8px',
                  color: session.id === activeSessionId ? '#e5e5e5' : '#737373',
                  fontSize: '12px',
                  cursor: 'pointer',
                  textAlign: 'left',
                  display: 'flex',
                  alignItems: 'flex-start',
                  justifyContent: 'space-between',
                  marginBottom: '2px',
                  position: 'relative',
                }}
                title={session.sessionTitle}
                onMouseEnter={e => {
                  if (session.id !== activeSessionId) e.currentTarget.style.background = '#141414';
                  const del = e.currentTarget.querySelector('[data-delete]') as HTMLElement;
                  if (del) del.style.opacity = '1';
                }}
                onMouseLeave={e => {
                  if (session.id !== activeSessionId) e.currentTarget.style.background = 'none';
                  const del = e.currentTarget.querySelector('[data-delete]') as HTMLElement;
                  if (del) del.style.opacity = '0';
                }}
              >
                <div style={{ overflow: 'hidden', flex: 1, minWidth: 0 }}>
                  <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {session.sessionTitle}
                  </div>
                  <div style={{ fontSize: '10px', color: '#606060', marginTop: '2px' }}>
                    {formatDate(session.createdAt)}
                  </div>
                </div>
                <span
                  data-delete
                  onClick={e => { e.stopPropagation(); deleteSession(session.id); }}
                  title="Delete"
                  style={{
                    opacity: 0,
                    color: '#737373',
                    fontSize: '14px',
                    cursor: 'pointer',
                    padding: '0 2px',
                    lineHeight: 1,
                    flexShrink: 0,
                    transition: 'opacity 0.1s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.color = '#ef4444')}
                  onMouseLeave={e => (e.currentTarget.style.color = '#737373')}
                >
                  x
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Center panel */}
      <div
        className="flex flex-col"
        style={{
          width: '380px',
          minWidth: '320px',
          borderRight: '1px solid #262626',
          background: '#111111',
          flexShrink: 0,
        }}
      >
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid #262626',
            fontSize: '15px',
            fontWeight: 600,
            letterSpacing: '-0.01em',
            color: '#f5f5f5',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <span>veomath <span style={{ color: '#737373', fontWeight: 400, fontSize: '12px' }}>/ explainer</span></span>
          <a
            href="/"
            style={{ fontSize: '11px', color: '#737373', textDecoration: 'none' }}
            onMouseEnter={e => (e.currentTarget.style.color = '#a3a3a3')}
            onMouseLeave={e => (e.currentTarget.style.color = '#737373')}
          >
            chat mode
          </a>
        </div>

        <div className="flex-1 overflow-y-auto" style={{ padding: '16px' }}>
          {/* Phase: input */}
          {activeSession?.phase === 'input' && (
            <div
              style={{
                color: '#737373',
                fontSize: '13px',
                textAlign: 'center',
                marginTop: '40px',
                lineHeight: 1.6,
              }}
            >
              Pick a topic and I&apos;ll create<br />
              an interactive explainer for it.<br />
              <br />
              <span style={{ color: '#606060' }}>
                Try &ldquo;Why e^i*pi = -1&rdquo;<br />
                or &ldquo;How derivatives work&rdquo;
              </span>
            </div>
          )}

          {/* Phase: planning */}
          {activeSession?.phase === 'planning' && (
            <div style={{ display: 'flex', alignItems: 'flex-start', marginTop: '20px' }}>
              <div
                style={{
                  padding: '8px 12px',
                  borderRadius: '14px 14px 14px 4px',
                  background: '#1e1e1e',
                  fontSize: '13px',
                  color: '#737373',
                }}
              >
                <span className="thinking-dots">planning your explainer</span>
              </div>
            </div>
          )}

          {/* Phase: plan-ready — minimal summary with general comments + proceed */}
          {activeSession?.phase === 'plan-ready' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ fontSize: '14px', fontWeight: 600, color: '#e5e5e5', marginBottom: '4px' }}>
                {activeSession.sessionTitle}
              </div>
              <p style={{ fontSize: '12px', color: '#737373', lineHeight: 1.5, margin: 0 }}>
                Review the plan on the right. Add comments to individual slides or provide general feedback below.
              </p>

              <div style={{ marginTop: '8px' }}>
                <div style={{ fontSize: '11px', color: '#737373', marginBottom: '4px' }}>
                  General comments (optional)
                </div>
                <textarea
                  value={planComments}
                  onChange={e => setPlanComments(e.target.value)}
                  placeholder="Any changes to the plan..."
                  rows={3}
                  style={{
                    width: '100%',
                    background: '#1a1a1a',
                    border: '1px solid #2a2a2a',
                    borderRadius: '8px',
                    padding: '8px 10px',
                    color: '#e5e5e5',
                    fontSize: '12px',
                    lineHeight: '1.5',
                    resize: 'vertical',
                    fontFamily: 'inherit',
                    outline: 'none',
                  }}
                />
              </div>

              <button
                onClick={proceedToGenerate}
                style={{
                  background: '#2563eb',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '8px',
                  padding: '8px 16px',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  marginTop: '4px',
                  transition: 'background 0.15s',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = '#1d4ed8')}
                onMouseLeave={e => (e.currentTarget.style.background = '#2563eb')}
              >
                Proceed
              </button>
            </div>
          )}

          {/* Phase: generating */}
          {activeSession?.phase === 'generating' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '20px' }}>
              <div
                style={{
                  padding: '8px 12px',
                  borderRadius: '14px 14px 14px 4px',
                  background: '#1e1e1e',
                  fontSize: '13px',
                  color: '#737373',
                }}
              >
                <span className="thinking-dots">{globalProgress || 'generating slides'}</span>
              </div>

              {slideProgress.size > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '8px' }}>
                  {Array.from(slideProgress.entries()).map(([idx, progress]) => {
                    const planItem = activeSession.planItems[idx];
                    const title = planItem?.type === 'slide' ? planItem.title : `Item ${idx}`;
                    return (
                      <div
                        key={idx}
                        style={{
                          background: '#1a1a1a',
                          border: '1px solid #2a2a2a',
                          borderRadius: '8px',
                          padding: '8px 10px',
                        }}
                      >
                        <div style={{ fontSize: '11px', fontWeight: 600, color: '#d4d4d4', marginBottom: '3px' }}>
                          {title}
                        </div>
                        <div style={{ fontSize: '10px', color: '#737373', display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span
                            style={{
                              display: 'inline-block',
                              width: '6px',
                              height: '6px',
                              borderRadius: '50%',
                              background: progress.stage === 'done' ? '#22c55e' : progress.stage === 'testing' ? '#eab308' : '#3b82f6',
                              flexShrink: 0,
                            }}
                          />
                          {progress.message}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Phase: ready — slide nav */}
          {activeSession?.phase === 'ready' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <div style={{ fontSize: '14px', fontWeight: 600, color: '#e5e5e5', marginBottom: '8px' }}>
                {activeSession.sessionTitle}
              </div>

              <div style={{ fontSize: '10px', color: '#606060', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>
                Slides
              </div>

              {slideItems.map(({ item, idx }, slideNum) => (
                <button
                  key={idx}
                  onClick={() => scrollToSlide(idx)}
                  style={{
                    width: '100%',
                    background: 'none',
                    border: '1px solid #2a2a2a',
                    borderRadius: '6px',
                    padding: '6px 10px',
                    color: '#a3a3a3',
                    fontSize: '12px',
                    cursor: 'pointer',
                    textAlign: 'left',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.borderColor = '#606060')}
                  onMouseLeave={e => (e.currentTarget.style.borderColor = '#2a2a2a')}
                >
                  <span style={{ color: '#737373', fontSize: '10px', fontWeight: 600, minWidth: '16px' }}>
                    {slideNum + 1}
                  </span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {item.title}
                  </span>
                  {item.error && <span style={{ color: '#ef4444', fontSize: '10px', marginLeft: 'auto', flexShrink: 0 }}>error</span>}
                  {item.isRegenerating && <span style={{ color: '#737373', fontSize: '10px', marginLeft: 'auto', flexShrink: 0 }}>...</span>}
                </button>
              ))}

              <button
                onClick={newSession}
                style={{
                  background: 'none',
                  border: '1px solid #2a2a2a',
                  borderRadius: '8px',
                  padding: '6px 12px',
                  color: '#737373',
                  fontSize: '11px',
                  cursor: 'pointer',
                  marginTop: '16px',
                }}
                onMouseEnter={e => (e.currentTarget.style.color = '#a3a3a3')}
                onMouseLeave={e => (e.currentTarget.style.color = '#737373')}
              >
                Start over
              </button>
            </div>
          )}
        </div>

        {/* Input area — only in input phase */}
        {activeSession?.phase === 'input' && (
          <div style={{ padding: '12px 16px', borderTop: '1px solid #262626' }}>
            <div
              style={{
                display: 'flex',
                gap: '8px',
                alignItems: 'flex-end',
                background: '#1a1a1a',
                borderRadius: '12px',
                padding: '8px 12px',
                border: '1px solid #2a2a2a',
              }}
            >
              <textarea
                ref={textareaRef}
                value={input}
                onChange={handleInput}
                onKeyDown={handleKeyDown}
                placeholder="What topic should I explain?"
                rows={1}
                disabled={isLoading}
                style={{
                  flex: 1,
                  background: 'none',
                  border: 'none',
                  outline: 'none',
                  color: '#e5e5e5',
                  fontSize: '13px',
                  lineHeight: '1.5',
                  resize: 'none',
                  fontFamily: 'inherit',
                }}
              />
              <button
                onClick={submitTopic}
                disabled={isLoading || !input.trim()}
                style={{
                  background: input.trim() && !isLoading ? '#2563eb' : '#262626',
                  color: input.trim() && !isLoading ? '#fff' : '#737373',
                  border: 'none',
                  borderRadius: '8px',
                  padding: '5px 12px',
                  fontSize: '12px',
                  cursor: input.trim() && !isLoading ? 'pointer' : 'default',
                  transition: 'background 0.15s',
                  flexShrink: 0,
                }}
              >
                Plan
              </button>
            </div>
            <div style={{ fontSize: '10px', color: '#606060', marginTop: '6px', textAlign: 'center' }}>
              Enter to send
            </div>
          </div>
        )}
      </div>

      {/* Right panel — scrollable document */}
      <div className="flex-1" style={{ background: '#0a0a0a', overflow: 'hidden', position: 'relative' }}>
        {activeSession?.phase === 'plan-ready' ? (
          <div style={{ height: '100%', overflowY: 'auto', padding: '48px 0' }}>
            <div style={{ maxWidth: '900px', margin: '0 auto', padding: '0 40px' }}>
              <div style={{ fontSize: '20px', fontWeight: 600, color: '#f5f5f5', marginBottom: '32px' }}>
                {activeSession.sessionTitle}
              </div>

              {activeSession.planItems.map((item, i) => (
                <div key={i} style={{ marginBottom: '20px' }}>
                  {item.type === 'text' ? (
                    <p style={{ fontSize: '16px', color: '#a3a3a3', lineHeight: 1.7, margin: 0, maxWidth: '720px' }}>
                      {item.content}
                    </p>
                  ) : (
                    <div
                      style={{
                        background: '#141414',
                        border: '1px solid #2a2a2a',
                        borderRadius: '12px',
                        padding: '20px 24px',
                      }}
                    >
                      <div style={{ fontSize: '15px', fontWeight: 600, color: '#d4d4d4', marginBottom: '8px' }}>
                        {item.title}
                      </div>
                      <div style={{ fontSize: '13px', color: '#737373', lineHeight: 1.6 }}>
                        {item.description}
                      </div>
                      <div style={{ marginTop: '12px', borderTop: '1px solid #2a2a2a', paddingTop: '12px' }}>
                        <textarea
                          value={planSlideComments.get(i) || ''}
                          onChange={e => {
                            setPlanSlideComments(prev => {
                              const next = new Map(prev);
                              next.set(i, e.target.value);
                              return next;
                            });
                          }}
                          placeholder="Comments for this slide..."
                          rows={2}
                          style={{
                            width: '100%',
                            background: '#1a1a1a',
                            border: '1px solid #2a2a2a',
                            borderRadius: '8px',
                            padding: '8px 10px',
                            color: '#e5e5e5',
                            fontSize: '12px',
                            lineHeight: '1.5',
                            resize: 'vertical',
                            fontFamily: 'inherit',
                            outline: 'none',
                          }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              ))}

              <div style={{ height: '120px' }} />
            </div>
          </div>
        ) : (activeSession?.phase === 'generating' || activeSession?.phase === 'ready') ? (
          <div style={{ height: '100%', overflowY: 'auto', padding: '48px 0' }}>
            <div style={{ maxWidth: '900px', margin: '0 auto', padding: '0 40px' }}>
              {activeSession.docItems.map((item, idx) => {
                if (item.type === 'placeholder') {
                  if (item.planType === 'text') {
                    return (
                      <div key={`ph-${idx}`} style={{ margin: '24px 0' }}>
                        <div style={{ height: '16px', width: '80%', background: '#1a1a1a', borderRadius: '4px', animation: 'pulse 1.5s ease-in-out infinite' }} />
                        <div style={{ height: '16px', width: '60%', background: '#1a1a1a', borderRadius: '4px', marginTop: '8px', animation: 'pulse 1.5s ease-in-out infinite' }} />
                      </div>
                    );
                  }
                  const progress = slideProgress.get(idx);
                  return (
                    <div key={`ph-${idx}`} style={{ margin: '32px 0' }}>
                      <div style={{ fontSize: '11px', color: '#737373', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px', fontWeight: 600 }}>
                        {item.title}
                      </div>
                      <div
                        style={{
                          width: '100%',
                          aspectRatio: '16 / 9',
                          background: '#111',
                          borderRadius: '8px',
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '12px',
                          border: '1px solid #1e1e1e',
                        }}
                      >
                        <div style={{ width: '32px', height: '32px', border: '2px solid #2a2a2a', borderTopColor: '#3b82f6', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                        <span style={{ color: '#606060', fontSize: '12px' }}>
                          {progress ? progress.message : 'Waiting to generate...'}
                        </span>
                      </div>
                    </div>
                  );
                }

                if (item.type === 'text') {
                  return (
                    <p
                      key={idx}
                      style={{
                        fontSize: '15px',
                        color: '#a3a3a3',
                        lineHeight: 1.7,
                        margin: '24px 0',
                        maxWidth: '680px',
                      }}
                    >
                      {item.content}
                    </p>
                  );
                }

                return (
                  <SlideBlock
                    key={`${idx}-${item.renderKey}`}
                    item={item}
                    itemIndex={idx}
                    sessionId={activeSession.id}
                    sessionTopic={activeSession.topic}
                    slideRefs={slideRefs}
                    onError={handleSlideError}
                    onRegenerate={regenerateSlide}
                    onCommentChange={(comment) => updateDocItem(activeSession.id, idx, { comment })}
                    onRestoreVersion={(versionIdx) => {
                      const code = (item.codeHistory || [])[versionIdx];
                      if (code) updateDocItem(activeSession.id, idx, { manimCode: code, renderKey: item.renderKey + 1, error: null });
                    }}
                    onFrameCapture={(frame) => { if (frame) slideFramesRef.current.set(idx, frame); }}
                  />
                );
              })}

              {activeSession.phase === 'ready' && (
                <div
                  style={{
                    marginTop: '48px',
                    padding: '24px',
                    background: '#111',
                    border: '1px solid #2a2a2a',
                    borderRadius: '12px',
                  }}
                >
                  <div style={{ fontSize: '14px', fontWeight: 600, color: '#d4d4d4', marginBottom: '12px' }}>
                    Regenerate this lesson
                  </div>
                  <p style={{ fontSize: '12px', color: '#737373', lineHeight: 1.5, margin: '0 0 12px 0' }}>
                    Provide overall feedback to generate a new version of this entire lesson, taking into account all slide comments.
                  </p>
                  <textarea
                    value={courseRegenerateFeedback}
                    onChange={e => setCourseRegenerateFeedback(e.target.value)}
                    placeholder="What would you like to change about this lesson?"
                    rows={4}
                    style={{
                      width: '100%',
                      background: '#1a1a1a',
                      border: '1px solid #2a2a2a',
                      borderRadius: '8px',
                      padding: '10px 12px',
                      color: '#e5e5e5',
                      fontSize: '13px',
                      lineHeight: '1.5',
                      resize: 'vertical',
                      fontFamily: 'inherit',
                      outline: 'none',
                    }}
                  />
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '12px' }}>
                    <button
                      onClick={regenerateCourse}
                      disabled={isRegeneratingCourse || !courseRegenerateFeedback.trim()}
                      style={{
                        background: courseRegenerateFeedback.trim() && !isRegeneratingCourse ? '#2563eb' : '#262626',
                        color: courseRegenerateFeedback.trim() && !isRegeneratingCourse ? '#fff' : '#737373',
                        border: 'none',
                        borderRadius: '8px',
                        padding: '8px 20px',
                        fontSize: '13px',
                        fontWeight: 600,
                        cursor: courseRegenerateFeedback.trim() && !isRegeneratingCourse ? 'pointer' : 'default',
                        transition: 'background 0.15s',
                      }}
                      onMouseEnter={e => {
                        if (courseRegenerateFeedback.trim() && !isRegeneratingCourse)
                          e.currentTarget.style.background = '#1d4ed8';
                      }}
                      onMouseLeave={e => {
                        if (courseRegenerateFeedback.trim() && !isRegeneratingCourse)
                          e.currentTarget.style.background = '#2563eb';
                      }}
                    >
                      {isRegeneratingCourse ? 'Regenerating...' : 'Regenerate Course'}
                    </button>
                  </div>
                </div>
              )}

              <div style={{ height: '120px' }} />
            </div>
          </div>
        ) : (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#262626',
              fontSize: '13px',
            }}
          >
            Your explainer will appear here
          </div>
        )}
      </div>
    </div>
  );
}

function SlideBlock({
  item,
  itemIndex,
  sessionId,
  sessionTopic,
  slideRefs,
  onError,
  onRegenerate,
  onCommentChange,
  onRestoreVersion,
  onFrameCapture,
}: {
  item: DocSlideItem;
  itemIndex: number;
  sessionId: string;
  sessionTopic: string;
  slideRefs: React.MutableRefObject<Map<number, HTMLDivElement>>;
  onError: (sessionId: string, itemIndex: number, failedCode: string, error: string) => void;
  onRegenerate: (itemIndex: number) => void;
  onCommentChange: (comment: string) => void;
  onRestoreVersion: (versionIdx: number) => void;
  onFrameCapture: (frame: string | null) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [commentOpen, setCommentOpen] = useState(false);

  useEffect(() => {
    if (containerRef.current) {
      slideRefs.current.set(itemIndex, containerRef.current);
    }
    return () => { slideRefs.current.delete(itemIndex); };
  }, [itemIndex, slideRefs]);

  const slideWrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const wrapper = slideWrapperRef.current;
    if (!wrapper) return;

    function repositionControls(el: HTMLElement) {
      if (!el.classList.contains('manimweb-controls')) return;
      el.style.position = 'absolute';
      el.style.top = '-36px';
      el.style.left = '0';
      el.style.right = 'auto';
      el.style.bottom = 'auto';
      el.style.width = 'auto';
      el.style.maxWidth = '100%';
      el.style.display = 'flex';
      el.style.flexDirection = 'row';
      el.style.flexWrap = 'wrap';
      el.style.alignItems = 'center';
      el.style.gap = '6px';

      let parent: HTMLElement | null = el.parentElement;
      while (parent && parent !== wrapper) {
        parent.style.overflow = 'visible';
        parent = parent.parentElement;
      }
    }

    wrapper.querySelectorAll<HTMLElement>('.manimweb-controls').forEach(repositionControls);

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (!(node instanceof HTMLElement)) continue;
          if (node.classList?.contains('manimweb-controls')) {
            repositionControls(node);
          }
          node.querySelectorAll<HTMLElement>('.manimweb-controls').forEach(repositionControls);
        }
      }
    });
    observer.observe(wrapper, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [item.renderKey]);

  const handleError = useCallback((failedCode: string, error: string) => {
    onError(sessionId, itemIndex, failedCode, error);
  }, [sessionId, itemIndex, onError]);

  const handleSuccess = useCallback((frame: string | null) => {
    onFrameCapture(frame);
  }, [onFrameCapture]);

  return (
    <div
      ref={containerRef}
      style={{ margin: '32px 0', position: 'relative' }}
    >
      {/* Slide title */}
      <div
        style={{
          fontSize: '11px',
          color: '#737373',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          marginBottom: '8px',
          fontWeight: 600,
        }}
      >
        {item.title}
      </div>

      {/* Canvas with controls above */}
      <div ref={slideWrapperRef} className="agentic-slide" style={{ position: 'relative', paddingTop: '44px' }}>
        <div
          style={{
            width: '100%',
            aspectRatio: '16 / 9',
            maxHeight: '420px',
            background: '#000',
            borderRadius: '8px',
            position: 'relative',
          }}
        >
          {item.isRegenerating ? (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#737373',
                fontSize: '13px',
                zIndex: 1,
              }}
            >
              <span className="thinking-dots">regenerating</span>
            </div>
          ) : (
            <SlideErrorBoundary onError={(err) => handleError(item.manimCode, err)}>
              <ManimRenderer
                code={item.manimCode}
                renderKey={item.renderKey}
                onError={handleError}
                onSuccess={handleSuccess}
              />
            </SlideErrorBoundary>
          )}
        </div>

        <button
          onClick={() => setCommentOpen(o => !o)}
          title="Add comment"
          style={{
            position: 'absolute',
            top: '50px',
            right: '-30px',
            background: commentOpen ? '#1e1e1e' : 'none',
            border: commentOpen ? '1px solid #3a3a3a' : '1px solid transparent',
            borderRadius: '6px',
            width: '26px',
            height: '26px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            transition: 'all 0.15s',
            zIndex: 10,
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = '#3a3a3a'; (e.currentTarget.querySelector('svg') as SVGElement).style.opacity = '0.8'; }}
          onMouseLeave={e => { if (!commentOpen) { e.currentTarget.style.borderColor = 'transparent'; (e.currentTarget.querySelector('svg') as SVGElement).style.opacity = commentOpen ? '0.8' : '0.3'; } }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: '#a3a3a3', opacity: commentOpen ? 0.8 : 0.3, transition: 'opacity 0.15s' }}>
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        </button>

        {commentOpen && (
          <div
            style={{
              position: 'absolute',
              top: '50px',
              right: '-260px',
              width: '220px',
              background: '#1a1a1a',
              border: '1px solid #2a2a2a',
              borderRadius: '8px',
              padding: '10px',
              zIndex: 20,
              boxShadow: '0 4px 24px rgba(0,0,0,0.5)',
            }}
          >
            <textarea
              value={item.comment}
              onChange={e => onCommentChange(e.target.value)}
              placeholder="What should change?"
              rows={3}
              style={{
                width: '100%',
                background: '#111',
                border: '1px solid #2a2a2a',
                borderRadius: '6px',
                padding: '6px 8px',
                color: '#e5e5e5',
                fontSize: '12px',
                lineHeight: '1.5',
                resize: 'vertical',
                fontFamily: 'inherit',
                outline: 'none',
              }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '6px', marginTop: '6px' }}>
              <button
                onClick={() => setCommentOpen(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#737373',
                  fontSize: '11px',
                  cursor: 'pointer',
                  padding: '2px 8px',
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => { onRegenerate(itemIndex); setCommentOpen(false); }}
                disabled={!item.comment.trim() || item.isRegenerating}
                style={{
                  background: item.comment.trim() ? '#2563eb' : '#262626',
                  color: item.comment.trim() ? '#fff' : '#737373',
                  border: 'none',
                  borderRadius: '6px',
                  padding: '3px 10px',
                  fontSize: '11px',
                  cursor: item.comment.trim() ? 'pointer' : 'default',
                }}
              >
                Regenerate
              </button>
            </div>
          </div>
        )}
      </div>

      {item.error && !item.isRegenerating && (
        <div
          style={{
            marginTop: '6px',
            background: '#1a0a0a',
            border: '1px solid #7f1d1d',
            borderRadius: '6px',
            padding: '6px 10px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '8px',
          }}
        >
          <span style={{ color: '#f87171', fontSize: '11px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            Render error
          </span>
          <button
            onClick={() => onRegenerate(itemIndex)}
            style={{
              background: 'none',
              border: '1px solid #7f1d1d',
              borderRadius: '6px',
              padding: '2px 8px',
              color: '#f87171',
              fontSize: '10px',
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            Retry
          </button>
        </div>
      )}

      {(item.codeHistory?.length ?? 0) > 1 && (
        <div
          style={{
            marginTop: '8px',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
          }}
        >
          {(item.codeHistory || []).map((code, vIdx) => {
            const isActive = code === item.manimCode;
            return (
              <button
                key={vIdx}
                onClick={() => onRestoreVersion(vIdx)}
                style={{
                  background: isActive ? '#2563eb' : '#1a1a1a',
                  border: `1px solid ${isActive ? '#2563eb' : '#2a2a2a'}`,
                  borderRadius: '10px',
                  padding: '2px 8px',
                  color: isActive ? '#fff' : '#737373',
                  fontSize: '10px',
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
                onMouseEnter={e => { if (!isActive) e.currentTarget.style.borderColor = '#606060'; }}
                onMouseLeave={e => { if (!isActive) e.currentTarget.style.borderColor = '#2a2a2a'; }}
              >
                v{vIdx + 1}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
