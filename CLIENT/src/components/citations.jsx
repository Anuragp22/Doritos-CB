import { useState } from 'react';
import { FileText, Quote } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

export default function Citations({ sources, className }) {
  const [active, setActive] = useState(null);
  if (!sources?.length) return null;

  return (
    <>
      <div
        className={cn(
          'mt-2 flex flex-wrap items-center gap-1.5',
          className
        )}
      >
        <span className="text-xs font-medium text-muted-foreground">
          Sources:
        </span>
        {sources.map((source) => (
          <button
            key={`${source.documentId}-${source.index}`}
            type="button"
            onClick={() => setActive(source)}
            className="inline-flex items-center gap-1.5 rounded-md border bg-card/40 px-2 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:bg-accent hover:text-foreground"
          >
            <FileText className="size-3" />
            <span className="max-w-[160px] truncate">{source.filename}</span>
            <span className="rounded-sm bg-muted px-1 text-[10px] tabular-nums">
              {source.index}
            </span>
          </button>
        ))}
      </div>

      <Dialog open={!!active} onOpenChange={(open) => !open && setActive(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="size-4 text-muted-foreground" />
              {active?.filename}
            </DialogTitle>
            <DialogDescription>
              Excerpt {active?.index} from your documents
              {typeof active?.score === 'number'
                ? ` · score ${active.score.toFixed(3)}`
                : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="flex max-h-[60vh] gap-3 overflow-y-auto rounded-md border bg-muted/20 px-4 py-3 text-sm leading-relaxed">
            <Quote className="mt-1 size-4 shrink-0 text-muted-foreground" />
            <p className="whitespace-pre-wrap">{active?.snippet}</p>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
