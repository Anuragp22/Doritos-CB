import { Link, Outlet } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth';
import { LogOut } from 'lucide-react';

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
      <Button asChild variant="ghost" size="sm">
        <Link to="/dashboard">Open app</Link>
      </Button>
      <span className="hidden text-muted-foreground sm:inline">{user.username}</span>
      <Button type="button" variant="outline" size="sm" onClick={logout}>
        <LogOut className="size-3.5" />
        Logout
      </Button>
    </div>
  );
};

const PublicLayout = () => {
  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center justify-between border-b border-border px-6 py-3 md:px-12">
        <Link to="/" className="font-serif text-lg font-semibold tracking-tight">
          Doritos <em className="font-normal italic text-primary">AI</em>
        </Link>
        <HeaderUser />
      </header>
      <main className="flex-1 overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
};

export default PublicLayout;
