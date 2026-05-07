import { Outlet, useNavigate } from 'react-router-dom';
import { useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import ChatList from '@/components/chatList/chatList';
import { useAuth } from '@/lib/auth';

const DashboardLayout = () => {
  const { user, isLoaded } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (isLoaded && !user) navigate('/sign-in');
  }, [isLoaded, user, navigate]);

  if (!isLoaded) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="grid h-full grid-cols-[280px_1fr]">
      <aside className="border-r border-border/60 bg-card/40">
        <ChatList />
      </aside>
      <section className="overflow-hidden bg-background">
        <Outlet />
      </section>
    </div>
  );
};

export default DashboardLayout;
