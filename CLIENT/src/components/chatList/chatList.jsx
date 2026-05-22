import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  MessageSquarePlus,
  FileText,
  MessageCircle,
  BrainCircuit,
  MoreHorizontal,
  Pencil,
  Trash2,
} from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

const API = import.meta.env.VITE_API_URL;
const MENU_WIDTH = 144;

const navLinkClasses = ({ isActive }) =>
  cn(
    'flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors',
    isActive
      ? 'bg-ink text-paper'
      : 'text-muted-foreground hover:bg-accent hover:text-foreground'
  );

// One chat in the list — handles its own ⋯ menu and inline rename.
function ChatRow({ chat, active, onRename, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(chat.title || '');
  const [menuPos, setMenuPos] = useState(null);
  const btnRef = useRef(null);

  const openMenu = () => {
    const r = btnRef.current.getBoundingClientRect();
    setMenuPos({ top: r.bottom + 4, left: Math.max(8, r.right - MENU_WIDTH) });
  };

  const saveRename = () => {
    const next = draft.trim();
    setEditing(false);
    if (next && next !== chat.title) onRename(next);
    else setDraft(chat.title || '');
  };

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') {
            setDraft(chat.title || '');
            setEditing(false);
          }
        }}
        onBlur={saveRename}
        className="w-full rounded-md border border-ring bg-background px-3 py-2 text-sm text-foreground outline-none"
      />
    );
  }

  return (
    <div className="group relative flex items-center">
      <Link
        to={`/dashboard/chats/${chat.id}`}
        className={cn(
          'flex min-w-0 flex-1 items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors',
          active
            ? 'bg-ink text-paper'
            : 'text-muted-foreground hover:bg-accent hover:text-foreground'
        )}
      >
        <MessageCircle className="size-3.5 shrink-0 opacity-70" />
        <span className="truncate">{chat.title || 'Untitled chat'}</span>
      </Link>
      <button
        ref={btnRef}
        type="button"
        onClick={openMenu}
        aria-label="Chat options"
        className={cn(
          'absolute right-1 flex size-7 items-center justify-center rounded-md transition-opacity hover:bg-accent',
          active ? 'text-paper hover:text-foreground' : 'text-muted-foreground hover:text-foreground',
          menuPos ? 'opacity-100' : 'opacity-0 focus-visible:opacity-100 group-hover:opacity-100'
        )}
      >
        <MoreHorizontal className="size-4" />
      </button>

      {menuPos &&
        createPortal(
          <>
            <div className="fixed inset-0 z-40" onClick={() => setMenuPos(null)} />
            <div
              className="fixed z-50 overflow-hidden rounded-md border border-border bg-popover py-1 shadow-md"
              style={{ top: menuPos.top, left: menuPos.left, width: MENU_WIDTH }}
            >
              <button
                type="button"
                onClick={() => {
                  setMenuPos(null);
                  setDraft(chat.title || '');
                  setEditing(true);
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-popover-foreground hover:bg-accent"
              >
                <Pencil className="size-3.5" /> Rename
              </button>
              <button
                type="button"
                onClick={() => {
                  setMenuPos(null);
                  onDelete();
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-destructive hover:bg-accent"
              >
                <Trash2 className="size-3.5" /> Delete
              </button>
            </div>
          </>,
          document.body
        )}
    </div>
  );
}

const ChatList = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState(null);

  const { isPending, error, data } = useQuery({
    queryKey: ['userChats'],
    queryFn: () =>
      fetch(`${API}/api/userchats`, { credentials: 'include' }).then((res) => res.json()),
  });

  const renameMutation = useMutation({
    mutationFn: ({ id, title }) =>
      fetch(`${API}/api/chats/${id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      }).then((r) => {
        if (!r.ok) throw new Error('Rename failed');
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['userChats'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) =>
      fetch(`${API}/api/chats/${id}`, { method: 'DELETE', credentials: 'include' }).then(
        (r) => {
          if (!r.ok) throw new Error('Delete failed');
        }
      ),
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: ['userChats'] });
      if (location.pathname === `/dashboard/chats/${id}`) navigate('/dashboard');
    },
  });

  return (
    <div className="flex h-full flex-col p-3">
      <div className="flex flex-col gap-1">
        <NavLink to="/dashboard" end className={navLinkClasses}>
          <MessageSquarePlus className="size-4" />
          Create new chat
        </NavLink>
        <NavLink to="/dashboard/documents" className={navLinkClasses}>
          <FileText className="size-4" />
          Documents
        </NavLink>
        <NavLink to="/dashboard/training" className={navLinkClasses}>
          <BrainCircuit className="size-4" />
          Training
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
            {data.map((chat) => (
              <ChatRow
                key={chat.id}
                chat={chat}
                active={location.pathname === `/dashboard/chats/${chat.id}`}
                onRename={(title) => renameMutation.mutate({ id: chat.id, title })}
                onDelete={() => setConfirmDelete(chat)}
              />
            ))}
          </div>
        )}
      </ScrollArea>

      <Dialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete chat?</DialogTitle>
            <DialogDescription>
              “{confirmDelete?.title || 'Untitled chat'}” and all of its messages will be
              permanently removed.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setConfirmDelete(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                deleteMutation.mutate(confirmDelete.id);
                setConfirmDelete(null);
              }}
            >
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ChatList;
