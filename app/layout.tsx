import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'Chewy Conversation Builder',
  description: 'Build, review, and download conversation JSON files for Articulate Rise practice.',
  icons: { icon: '/favicon.svg' },
  openGraph: {
    title: 'Chewy Conversation Builder',
    description: 'Build. Review. Download.',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'Conversation Builder — Build. Review. Download.' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Chewy Conversation Builder',
    description: 'Build. Review. Download.',
    images: ['/og.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
