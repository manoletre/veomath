'use client';

import { Button } from '@/components/ui/button';

const prompts = [
  { title: 'Pythagorean theorem', prompt: 'Show me a visual proof of the Pythagorean theorem using squares on a right triangle.' },
  { title: 'Unit circle', prompt: 'Animate the unit circle and show how sine and cosine change as the angle moves.' },
  { title: 'Derivatives', prompt: 'Show how a secant line becomes a tangent line and explain the derivative of x squared.' },
  { title: 'Bayes’ theorem', prompt: 'Visualize Bayes’ theorem with a simple medical test example and explain false positives.' },
];

export default function PromptSuggestions({ onSelect, disabled = false }: { onSelect: (prompt: string) => void; disabled?: boolean }) {
  return <div aria-label="Suggested questions" className="mt-3 flex flex-wrap justify-center gap-2">
    {prompts.map(({ title, prompt }) => <Button key={title} variant="outline" size="sm" disabled={disabled} className="h-auto whitespace-normal px-3 py-1.5 text-sm" onClick={() => onSelect(prompt)}>{title}</Button>)}
  </div>;
}
