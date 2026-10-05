'use client';

import Image from 'next/image';
import type { ComponentProps } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// Based on the public Google-login preview, using the open-source shadcn Button:
// https://www.shadcnblocks.com/component/login-button/login-button-social-1
// Hover lifts the button instead of dimming it: a dimmed background shows the icon's white square.
export function LoginButtonSocial1({ className, label = 'Continue with Google', ...props }: Omit<ComponentProps<typeof Button>, 'children'> & { label?: string }) {
  return (
    <Button type="button" size="lg" className={cn('w-full transition duration-200 hover:-translate-y-0.5 hover:bg-primary hover:shadow-lg motion-reduce:hover:translate-y-0', className)} {...props}>
      <span className="relative size-5 shrink-0 overflow-hidden" aria-hidden="true">
        <Image
          src="/google-signin-icon.png"
          alt=""
          width={40}
          height={40}
          className="absolute -left-2.5 -top-2.5 max-w-none"
          unoptimized
        />
      </span>
      {label}
    </Button>
  );
}
