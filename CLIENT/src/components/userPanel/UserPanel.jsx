import { LogOut } from 'lucide-react';
import { useAuth } from '@/lib/auth';

const UserPanel = () => {
  const { user, logout } = useAuth();
  if (!user) return null;

  return (
    <div className="border-t border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-ink text-sm font-semibold text-paper">
            {user.username?.[0]?.toUpperCase() ?? '?'}
          </div>
          <span className="truncate text-sm font-medium">{user.username}</span>
        </div>
        <button
          type="button"
          onClick={logout}
          aria-label="Log out"
          className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <LogOut className="size-4" />
        </button>
      </div>
    </div>
  );
};

export default UserPanel;
