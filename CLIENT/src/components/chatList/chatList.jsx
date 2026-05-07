import { Link, NavLink, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { MessageSquarePlus, FileText, MessageCircle, Loader2 } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

const navLinkClasses = ({ isActive }) =>
  cn(
    'flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors',
    isActive
      ? 'bg-ink text-paper'
      : 'text-muted-foreground hover:bg-accent hover:text-foreground'
  );

const ChatList = () => {
  const location = useLocation();
  const { isPending, error, data } = useQuery({
    queryKey: ['userChats'],
    queryFn: () =>
      fetch(`${import.meta.env.VITE_API_URL}/api/userchats`, {
        credentials: 'include',
      }).then((res) => res.json()),
  });

  return (
    <div className="flex h-full flex-col p-3">
      <div className="flex flex-col gap-1">
        <NavLink
          to="/dashboard"
          end
          className={navLinkClasses}
        >
          <MessageSquarePlus className="size-4" />
          Create new chat
        </NavLink>
        <NavLink to="/dashboard/documents" className={navLinkClasses}>
          <FileText className="size-4" />
          Documents
        </NavLink>
      </div>

      <div className="my-3 h-px bg-border/60" />

      <span className="px-3 pb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        Recent chats
      </span>

      <ScrollArea className="-mx-3 flex-1 px-3">
        {isPending ? (
          <div className="flex flex-col gap-2 px-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-7 w-full" />
            ))}
          </div>
        ) : error ? (
          <div className="px-3 text-xs text-destructive">Failed to load chats.</div>
        ) : !data?.length ? (
          <div className="px-3 text-xs text-muted-foreground">No chats yet.</div>
        ) : (
          <div className="flex flex-col gap-1">
            {data.map((chat) => {
              const active = location.pathname === `/dashboard/chats/${chat.id}`;
              return (
                <Link
                  key={chat.id}
                  to={`/dashboard/chats/${chat.id}`}
                  className={cn(
                    'flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors',
                    active
                      ? 'bg-ink text-paper'
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                  )}
                >
                  <MessageCircle className="size-3.5 shrink-0 opacity-70" />
                  <span className="truncate">{chat.title || 'Untitled chat'}</span>
                </Link>
              );
            })}
          </div>
        )}
      </ScrollArea>
    </div>
  );
};

export default ChatList;
