import Image from 'next/image';

export default function MathLogo({ size = 24 }: { size?: number }) {
  return (
    <Image
      src="/math-logo.png"
      alt=""
      width={size}
      height={size}
      style={{ flexShrink: 0 }}
    />
  );
}
