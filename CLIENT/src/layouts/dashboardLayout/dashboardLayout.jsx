import { Outlet, useLocation, useNavigate, Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { Loader2, Menu } from 'lucide-react';
import ChatList from '@/components/chatList/chatList';
import SidebarBrand from '@/components/sidebarBrand/SidebarBrand';
import UserPanel from '@/components/userPanel/UserPanel';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';

const SidebarContents = () => (
  <div className="flex h-full flex-col">
    <SidebarBrand />
    <div className="flex-1 overflow-hidden">
      <ChatList />
    </div>
    <UserPanel />
  </div>
);

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
      <div className="flex h-screen items-center justify-center text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col md:grid md:grid-cols-[260px_1fr]">
      <aside className="hidden h-full border-r border-border bg-card md:block">
        <SidebarContents />
      </aside>

      <div className="flex h-full flex-col overflow-hidden bg-background">
        <div className="flex items-center justify-between border-b border-border bg-card px-3 py-2 md:hidden">
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
            <SheetContent side="left" className="w-72 bg-card p-0">
              <SheetHeader className="sr-only">
                <SheetTitle>Navigation</SheetTitle>
              </SheetHeader>
              <SidebarContents />
            </SheetContent>
          </Sheet>
          <Link to="/dashboard" className="font-serif text-base font-semibold tracking-tight">
            Doritos <em className="font-normal italic text-primary">AI</em>
          </Link>
          <span className="size-9" aria-hidden />
        </div>
        <section className="flex-1 overflow-hidden">
          <Outlet />
        </section>
      </div>
    </div>
  );
};

export default DashboardLayout;
