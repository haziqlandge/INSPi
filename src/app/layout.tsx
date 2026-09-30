import type { Metadata, Viewport } from 'next';
import { Fraunces, Geist_Mono, Instrument_Sans } from 'next/font/google';
import { Suspense, type ReactNode } from 'react';
import { SparkProvider } from '@/components/feedback/spark';
import { ToastProvider } from '@/components/feedback/toast';
import { Dock } from '@/components/shell/dock';
import { Header } from '@/components/shell/header';
import { themeScript } from '@/components/shell/theme-toggle';
import { UploadProvider } from '@/components/upload/upload-provider';
import './globals.css';

const fraunces = Fraunces({
  subsets: ['latin'],
  axes: ['SOFT', 'opsz'],
  variable: '--font-fraunces',
  display: 'swap',
});

const instrumentSans = Instrument_Sans({
  subsets: ['latin'],
  variable: '--font-instrument',
  display: 'swap',
});

const geistMono = Geist_Mono({
  subsets: ['latin'],
  variable: '--font-geist-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: { default: 'INSPi', template: '%s · INSPi' },
  description: 'A private library of visual references, each with a prompt that lets an AI recreate its look.',
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#efe4cb' },
    { media: '(prefers-color-scheme: dark)', color: '#191113' },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${fraunces.variable} ${instrumentSans.variable} ${geistMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/* Runs while the HTML is parsed. On the client it is inert, which keeps React from warning about it. */}
        <script
          type={typeof window === 'undefined' ? 'text/javascript' : 'text/plain'}
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: themeScript }}
        />
      </head>
      <body>
        <SparkProvider>
          <ToastProvider>
            <UploadProvider>
            <Header />
            <main className="pb-[var(--dock-space)]">{children}</main>
            <Suspense fallback={null}>
              <Dock />
            </Suspense>
            </UploadProvider>
          </ToastProvider>
        </SparkProvider>
      </body>
    </html>
  );
}
