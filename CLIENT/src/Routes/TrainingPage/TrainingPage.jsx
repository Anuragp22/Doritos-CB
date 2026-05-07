import { useEffect, useState } from 'react';
import { ExternalLink, BrainCircuit, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

const TRAINER_URL = import.meta.env.VITE_TRAINER_URL || 'http://localhost:7860';

const pingTrainer = async () => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  try {
    await fetch(TRAINER_URL, { mode: 'no-cors', signal: controller.signal });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
};

const TrainingPage = () => {
  const [status, setStatus] = useState('checking');

  const refresh = async () => {
    setStatus('checking');
    setStatus((await pingTrainer()) ? 'online' : 'offline');
  };

  useEffect(() => {
    refresh();
  }, []);

  const statusLabel = {
    checking: 'Checking…',
    online: 'Running',
    offline: 'Offline',
  }[status];

  const statusDot = {
    checking: 'bg-muted-foreground',
    online: 'bg-emerald-600',
    offline: 'bg-muted-foreground/40',
  }[status];

  return (
    <div className="h-full overflow-y-auto px-6 py-10 md:px-12">
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="space-y-2">
          <h1 className="font-serif text-3xl font-semibold tracking-tight">
            Train <em className="font-normal italic text-primary">your model</em>
          </h1>
          <p className="text-sm text-muted-foreground">
            Fine-tune Qwen2-VL on your registered datasets using LLaMA-Factory's
            built-in Web UI. Pick a dataset, configure LoRA hyperparameters, and
            kick off a run.
          </p>
        </div>

        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
            <div className="flex items-start gap-3">
              <div className="rounded-md bg-accent p-2">
                <BrainCircuit className="size-5 text-foreground" />
              </div>
              <div>
                <CardTitle className="text-base">LLaMA-Factory Web UI</CardTitle>
                <CardDescription>
                  Gradio interface for SFT, LoRA, QLoRA, and DPO training runs.
                </CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className={`size-2 rounded-full ${statusDot}`} aria-hidden />
              <span>{statusLabel}</span>
            </div>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              onClick={() => window.open(TRAINER_URL, '_blank', 'noopener,noreferrer')}
              disabled={status !== 'online'}
            >
              <ExternalLink className="size-4" />
              Launch Training UI
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={refresh}>
              <RefreshCw className="size-3.5" />
              Recheck
            </Button>
          </CardContent>
        </Card>

        {status === 'offline' && (
          <Card className="border-dashed">
            <CardHeader>
              <CardTitle className="text-sm">Trainer not running</CardTitle>
              <CardDescription>
                Start it with the model profile from the repo root:
              </CardDescription>
            </CardHeader>
            <CardContent>
              <pre className="overflow-x-auto rounded-md bg-muted px-3 py-2 font-mono text-xs">
                docker compose --profile model up trainer
              </pre>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Workflow</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>
              1. Register a dataset with{' '}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
                python MODEL/register_dataset.py
              </code>
              .
            </p>
            <p>
              2. Open the Web UI, pick model{' '}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
                Qwen/Qwen2-VL-2B-Instruct
              </code>{' '}
              and your dataset.
            </p>
            <p>
              3. Choose <strong>LoRA</strong> stage <strong>SFT</strong>, set
              learning rate and epochs, then start training.
            </p>
            <p>
              4. Point the inference server at the resulting checkpoint via{' '}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
                MODEL_ID
              </code>
              .
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default TrainingPage;
