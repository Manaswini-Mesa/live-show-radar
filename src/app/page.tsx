import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, verifySession, loginRequired } from '@/lib/auth';
import Dashboard from './dashboard';


export default async function Home() {
  const jar = await cookies();
  if (loginRequired() && !verifySession(jar.get(SESSION_COOKIE)?.value)) redirect('/login');
  return <Dashboard />;
}
