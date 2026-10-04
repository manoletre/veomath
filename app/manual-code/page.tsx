'use client';

import { useState, useRef, useCallback } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';

const ManimRenderer = dynamic(() => import('../components/ManimRenderer'), { ssr: false });

export default function ManualCodePage() {
    const [code, setCode] = useState('');
    const [activeCode, setActiveCode] = useState<string | null>(null);
    const [renderKey, setRenderKey] = useState(0);
    const [runtimeError, setRuntimeError] = useState<string | null>(null);
    const [renderError, setRenderError] = useState<string | null>(null);
    const [manimExports, setManimExports] = useState<string[]>([]);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    const handleRuntimeError = useCallback((error: string) => {
        setRuntimeError(error);
    }, []);

    const handleReady = useCallback((exportKeys: string[]) => {
        setManimExports(exportKeys);
    }, []);

    const handleRenderError = useCallback((_failedCode: string, error: string) => {
        setRenderError(error);
    }, []);

    const handleRenderSuccess = useCallback(() => {
        setRenderError(null);
    }, []);

    function runCode() {
        const trimmed = code.trim();
        if (!trimmed) return;
        setRuntimeError(null);
        setRenderError(null);
        setActiveCode(trimmed);
        setRenderKey(k => k + 1);
    }

    function clearAll() {
        setCode('');
        setActiveCode(null);
        setRuntimeError(null);
        setRenderError(null);
        setRenderKey(k => k + 1);
    }

    function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
        // Cmd/Ctrl+Enter to run
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            runCode();
        }
        // Tab inserts 2 spaces
        if (e.key === 'Tab') {
            e.preventDefault();
            const ta = textareaRef.current;
            if (!ta) return;
            const start = ta.selectionStart;
            const end = ta.selectionEnd;
            const val = ta.value;
            const newVal = val.substring(0, start) + '  ' + val.substring(end);
            setCode(newVal);
            requestAnimationFrame(() => {
                ta.selectionStart = ta.selectionEnd = start + 2;
            });
        }
    }

    return (
        <div style={{ display: 'flex', height: '100vh', background: '#0a0a0a', color: 'var(--foreground)' }}>
            {/* Left: Code editor */}
            <div
                style={{
                    width: '480px',
                    minWidth: '360px',
                    borderRight: '1px solid var(--border)',
                    display: 'flex',
                    flexDirection: 'column',
                    background: '#0d0d0d',
                    flexShrink: 0,
                }}
            >
                {/* Header */}
                <div
                    style={{
                        padding: '12px 16px',
                        borderBottom: '1px solid var(--border)',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                    }}
                >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <Link
                            href="/"
                            style={{
                                color: 'var(--muted-foreground)',
                                fontSize: '12px',
                                textDecoration: 'none',
                            }}
                        >
                            ← back
                        </Link>
                        <span style={{ fontSize: '14px', fontWeight: 600, letterSpacing: '-0.01em' }}>
                            manual code
                        </span>
                    </div>
                    <div style={{ display: 'flex', gap: '6px' }}>
                        <button
                            onClick={clearAll}
                            style={{
                                background: 'none',
                                border: '1px solid var(--input)',
                                borderRadius: '6px',
                                padding: '4px 10px',
                                color: 'var(--muted-foreground)',
                                fontSize: '11px',
                                cursor: 'pointer',
                            }}
                        >
                            clear
                        </button>
                        <button
                            onClick={runCode}
                            disabled={!code.trim()}
                            style={{
                                background: code.trim() ? '#2563eb' : '#1a1a1a',
                                border: 'none',
                                borderRadius: '6px',
                                padding: '4px 14px',
                                color: code.trim() ? '#fff' : 'var(--muted-foreground)',
                                fontSize: '11px',
                                fontWeight: 600,
                                cursor: code.trim() ? 'pointer' : 'default',
                            }}
                        >
                            Run ⌘↵
                        </button>
                    </div>
                </div>

                {/* Available exports indicator */}
                {manimExports.length > 0 && (
                    <div
                        style={{
                            padding: '6px 16px',
                            borderBottom: '1px solid var(--border)',
                            fontSize: '10px',
                            color: 'var(--muted-foreground)',
                            display: 'flex',
                            gap: '8px',
                            flexWrap: 'wrap',
                        }}
                    >
                        <span style={{ color: 'var(--muted-foreground)' }}>available:</span>
                        {['makeDraggable', 'makeHoverable', 'makeClickable', 'Controls'].map(name => (
                            <span
                                key={name}
                                style={{ color: manimExports.includes(name) ? '#4ade80' : '#f87171' }}
                            >
                                {name} {manimExports.includes(name) ? '✓' : '✗'}
                            </span>
                        ))}
                    </div>
                )}

                {/* Textarea */}
                <div style={{ flex: 1, overflow: 'hidden' }}>
                    <textarea
                        ref={textareaRef}
                        value={code}
                        onChange={e => setCode(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder={`// Paste manim-web code here\n// All manim-web exports are available (Scene, Circle, makeDraggable, etc.)\n// \`scene\` is pre-created — just use it directly\n// Press ⌘+Enter to run\n\nconst dot = new Dot({ point: [0, 0, 0], color: YELLOW, radius: 0.15 });\nscene.add(dot);\nmakeDraggable(dot, scene);\nmakeHoverable(dot, scene, { hoverScale: 1.5, hoverColor: RED });\n\nawait scene.wait(999999);`}
                        spellCheck={false}
                        style={{
                            width: '100%',
                            height: '100%',
                            background: 'transparent',
                            border: 'none',
                            outline: 'none',
                            color: 'var(--secondary-foreground)',
                            fontSize: '12px',
                            fontFamily: "'SF Mono', Monaco, Consolas, 'Courier New', monospace",
                            lineHeight: '1.7',
                            padding: '16px',
                            resize: 'none',
                            tabSize: 2,
                            boxSizing: 'border-box',
                        }}
                    />
                </div>

                {/* Error display */}
                {(renderError || runtimeError) && (
                    <div
                        style={{
                            padding: '10px 16px',
                            borderTop: '1px solid #7f1d1d',
                            background: '#1a0a0a',
                            maxHeight: '180px',
                            overflowY: 'auto',
                        }}
                    >
                        <div style={{ fontSize: '10px', color: '#ef4444', fontWeight: 600, marginBottom: '4px' }}>
                            {renderError ? '✗ Render Error' : '⚠ Runtime Error'}
                        </div>
                        <pre
                            style={{
                                color: '#f87171',
                                fontSize: '11px',
                                margin: 0,
                                whiteSpace: 'pre-wrap',
                                fontFamily: 'monospace',
                                lineHeight: 1.5,
                            }}
                        >
                            {renderError || runtimeError}
                        </pre>
                    </div>
                )}
            </div>

            {/* Right: Renderer */}
            <div style={{ flex: 1, position: 'relative', background: '#000', overflow: 'hidden' }}>
                {activeCode ? (
                    <ManimRenderer
                        code={activeCode}
                        renderKey={renderKey}
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
                            flexDirection: 'column',
                            gap: '8px',
                        }}
                    >
                        <span>Paste code and press Run</span>
                        <span style={{ fontSize: '11px', color: 'var(--muted-foreground)' }}>⌘+Enter to run</span>
                    </div>
                )}
            </div>
        </div>
    );
}
