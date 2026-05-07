import { Link, Outlet } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LogOut } from 'lucide-react';
import { AuthProvider, useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Toaster } from '@/components/ui/sonner';

const queryClient = new QueryClient();

const HeaderUser = () => {
  const { user, isLoaded, logout } = useAuth();
  if (!isLoaded) return null;

  if (!user) {
    return (
      <div className="flex items-center gap-2 text-sm">
        <Button asChild variant="ghost" size="sm">
          <Link to="/sign-in">Sign in</Link>
        </Button>
        <Button asChild size="sm">
          <Link to="/sign-up">Sign up</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="text-muted-foreground">{user.username}</span>
      <Button type="button" variant="outline" size="sm" onClick={logout}>
        <LogOut className="size-3.5" />
        Logout
      </Button>
    </div>
  );
};

const RootLayout = () => {
  return (
    <AuthProvider>
      <QueryClientProvider client={queryClient}>
        <div className="flex h-screen flex-col">
          <header className="flex items-center justify-between border-b border-border/60 px-6 py-3 md:px-12">
            <Link to="/" className="flex items-center gap-2 font-semibold">
              <img src="/logo.png" alt="logo" className="size-8" />
              <span>DORITOS AI</span>
            </Link>
            <HeaderUser />
          </header>
          <main className="flex-1 overflow-hidden">
            <Outlet />
          </main>
        </div>
        <Toaster position="top-right" richColors />
      </QueryClientProvider>
    </AuthProvider>
  );
};

export default RootLayout;
