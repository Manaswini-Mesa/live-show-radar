import { redirect } from 'next/navigation';
import { loginRequired } from '@/lib/auth';
import LoginForm from './form';

export default function Login() {
  if (!loginRequired()) redirect('/');
  return <LoginForm />;
}
