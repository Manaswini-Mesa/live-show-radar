import type { Metadata } from 'next';
import { Fredoka, Righteous } from 'next/font/google';
import './globals.css';

const body = Fredoka({ subsets: ['latin'], variable: '--font-body', weight: ['400', '500', '600', '700'] });
const display = Righteous({ subsets: ['latin'], variable: '--font-display', weight: '400' });

export const metadata: Metadata = {
  title: 'KConcerts',
  description: 'Never miss a show — concert & festival alerts across India for the artists you love.',
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
