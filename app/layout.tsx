import type { Metadata } from "next";
import { PT_Serif } from "next/font/google";
import "./globals.css";
import AuthGate from './components/AuthGate';

const ptSerif = PT_Serif({
  variable: "--font-pt-serif",
  weight: ["400", "700"],
  style: ["normal", "italic"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "veomath",
  description: "Learn math visually. Ask a question and get an interactive animation that shows why it’s true.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${ptSerif.variable} antialiased`}
      >
        <AuthGate>{children}</AuthGate>
      </body>
    </html>
  );
}
