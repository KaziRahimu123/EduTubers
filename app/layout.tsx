import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { Auth0Provider } from '@auth0/nextjs-auth0/client';
import { ThemeProvider } from '@/components/ThemeProvider';
import './globals.css';

export const metadata: Metadata = {
  title: 'EduTubers — Turn your content into interactive audience experiences',
  description: 'Transform your videos, podcasts, articles, and newsletters into interactive content assets — flashcard decks, quizzes, interactive challenges, content guides, and illustrated explainers.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <Auth0Provider>
          <ThemeProvider>{children}</ThemeProvider>
        </Auth0Provider>
      </body>
    </html>
  );
}
