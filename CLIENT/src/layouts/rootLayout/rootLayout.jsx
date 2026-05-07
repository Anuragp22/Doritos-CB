import { Link, Outlet } from 'react-router-dom';
import './rootLayout.css';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from '../../lib/auth';

const queryClient = new QueryClient();

const HeaderUser = () => {
  const { user, isLoaded, logout } = useAuth();
  if (!isLoaded) return null;

  if (!user) {
    return (
      <div className='authLinks'>
        <Link to='/sign-in'>Sign in</Link>
        <Link to='/sign-up' className='primary'>Sign up</Link>
      </div>
    );
  }

  return (
    <div className='authLinks'>
      <span className='username'>{user.username}</span>
      <button type='button' onClick={logout}>Logout</button>
    </div>
  );
};

const RootLayout = () => {
  return (
    <AuthProvider>
      <QueryClientProvider client={queryClient}>
        <div className='rootLayout'>
          <header className='header'>
            <Link className='logo' to='/'>
              <img src='/logo.png' alt='logo' />
              <span>DORITOS AI</span>
            </Link>
            <div className='user'>
              <HeaderUser />
            </div>
          </header>
          <main className='main'>
            <Outlet />
          </main>
        </div>
      </QueryClientProvider>
    </AuthProvider>
  );
};

export default RootLayout;
