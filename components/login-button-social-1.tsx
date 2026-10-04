'use client';

import Image from 'next/image';
import type { ComponentProps } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// Based on the public Google-login preview, using the open-source shadcn Button:
// https://www.shadcnblocks.com/component/login-button/login-button-social-1
export function LoginButtonSocial1({ className, ...props }: Omit<ComponentProps<typeof Button>, 'children'>) {
  return (
    <Button type="button" size="lg" className={cn('w-full', className)} {...props}>
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
      Continue with Google
    </Button>
  );
}
