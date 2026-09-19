import type { Metadata, Viewport } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Opportuna — Hospital Growth & Patient Opportunity Command Centre',
  description:
    'Operational intelligence platform that turns hospital system data into prioritised, owned and measurable patient opportunities.',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f6f8fa' },
    { media: '(prefers-color-scheme: dark)', color: '#0f131d' },
  ],
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/*
          Applied before first paint so a dark-mode user never sees a white
          flash. It runs ahead of React, so it must not depend on any bundle.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('opportuna-theme');var d=t==='dark'||(!t&&window.matchMedia('(prefers-color-scheme: dark)').matches);if(d)document.documentElement.classList.add('dark');}catch(e){}})();`,
          }}
        />
      </head>
      <body className="min-h-full">{children}</body>
    </html>
  )
}
