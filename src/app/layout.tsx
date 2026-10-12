import type { Metadata } from 'next';
import { Cormorant_Garamond, Jost } from 'next/font/google';
import './globals.css';

const body = Jost({ subsets: ['latin'], variable: '--font-body', weight: ['200', '300', '400', '500'] });
const display = Cormorant_Garamond({ subsets: ['latin'], variable: '--font-display', weight: ['300', '400'], style: ['normal', 'italic'] });

export const metadata: Metadata = {
  title: 'KConcerts',
  description: 'Never miss a show - concert & festival alerts across India for the artists you love.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${body.variable} ${display.variable}`}>
      <body>
        <div className="blobs" aria-hidden><span /><span /><span /><span /></div>
        {children}
      </body>
    </html>
  );
}
