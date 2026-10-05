'use client';

import { useState, useRef, useCallback } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

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
        <div style={{ display: 'flex', height: '100vh', background: 'var(--background)', color: 'var(--foreground)' }}>
            {/* Left: Code editor */}
            <div
                style={{
                    width: 'min(480px, 55vw)',
                    minWidth: 'min(360px, 55vw)',
                    borderRight: '1px solid var(--border)',
                    display: 'flex',
                    flexDirection: 'column',
                    background: 'var(--card)',
                    flexShrink: 0,
                }}
            >
                {/* Header */}
                <div
                    style={{
                        padding: '10px 12px',
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
                                fontSize: '15px',
                                textDecoration: 'none',
                            }}
                        >
                            ← back
                        </Link>
                        <span style={{ fontSize: '17px', fontWeight: 600, letterSpacing: '-0.01em' }}>
                            manual code
                        </span>
                    </div>
                    <div style={{ display: 'flex', gap: '6px' }}>
                        <Button variant="outline"
                            onClick={clearAll}

                        >
                            clear
                        </Button>
                        <Button variant="default"
                            onClick={runCode}
                            disabled={!code.trim()}

                        >
                            Run ⌘↵
                        </Button>
                    </div>
                </div>

                {/* Available exports indicator */}
                {manimExports.length > 0 && (
                    <div
                        style={{
                            padding: '6px 12px',
                            borderBottom: '1px solid var(--border)',
                            fontSize: '13px',
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
                                style={{ color: manimExports.includes(name) ? 'var(--success)' : 'var(--destructive)' }}
                            >
                                {name} {manimExports.includes(name) ? '✓' : '✗'}
                            </span>
                        ))}
                    </div>
                )}

                {/* Textarea */}
                <div style={{ flex: 1, overflow: 'hidden' }}>
                    <Textarea
                        aria-label="Animation code" ref={textareaRef}
                        value={code}
                        onChange={e => setCode(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder={`// Paste manim-web code here\n// All manim-web exports are available (Scene, Circle, makeDraggable, etc.)\n// \`scene\` is pre-created — just use it directly\n// Press ⌘+Enter to run\n\nconst dot = new Dot({ point: [0, 0, 0], color: YELLOW, radius: 0.15 });\nscene.add(dot);\nmakeDraggable(dot, scene);\nmakeHoverable(dot, scene, { hoverScale: 1.5, hoverColor: RED });\n\nawait scene.wait(999999);`}
                        spellCheck={false}
                        style={{ width: '100%', height: '100%', resize: 'none', tabSize: 2, boxSizing: 'border-box' }}
                    />
                </div>

                {/* Error display */}
                {(renderError || runtimeError) && (
                    <div
                        style={{
                            padding: '8px 12px',
                            borderTop: '1px solid var(--destructive)',
                            background: 'var(--danger-surface)',
                            maxHeight: '180px',
                            overflowY: 'auto',
                        }}
                    >
                        <div style={{ fontSize: '13px', color: 'var(--destructive)', fontWeight: 600, marginBottom: '4px' }}>
                            {renderError ? '✗ Render Error' : '⚠ Runtime Error'}
                        </div>
                        <pre
                            style={{
                                color: 'var(--destructive)',
                                fontSize: '14px',
                                margin: 0,
                                whiteSpace: 'pre-wrap',
                                fontFamily: 'inherit',
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
                            fontSize: '16px',
                            flexDirection: 'column',
                            gap: '8px',
                        }}
                    >
                        <span>Paste code and press Run</span>
                        <span style={{ fontSize: '14px', color: 'var(--muted-foreground)' }}>⌘+Enter to run</span>
                    </div>
                )}
            </div>
        </div>
    );
}
