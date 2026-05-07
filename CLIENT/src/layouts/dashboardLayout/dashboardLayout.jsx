import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { Loader2, Menu } from 'lucide-react';
import ChatList from '@/components/chatList/chatList';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';

const DashboardLayout = () => {
  const { user, isLoaded } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    if (isLoaded && !user) navigate('/sign-in');
  }, [isLoaded, user, navigate]);

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  if (!isLoaded) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="md:grid md:h-full md:grid-cols-[280px_1fr]">
      <aside className="hidden h-full border-r border-border/60 bg-card/40 md:block">
        <ChatList />
      </aside>

      <div className="flex h-full flex-col overflow-hidden bg-background">
        <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2 md:hidden">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              onClick={() => setMobileOpen(true)}
              aria-label="Open sidebar"
            >
              <Menu className="size-5" />
            </Button>
            <SheetContent side="left" className="w-72 p-0">
              <SheetHeader className="sr-only">
                <SheetTitle>Navigation</SheetTitle>
              </SheetHeader>
              <ChatList />
            </SheetContent>
          </Sheet>
          <span className="text-sm font-medium">Doritos AI</span>
        </div>
        <section className="flex-1 overflow-hidden">
          <Outlet />
        </section>
      </div>
    </div>
  );
};

export default DashboardLayout;
