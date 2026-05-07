import { Link } from 'react-router-dom';
import { TypeAnimation } from 'react-type-animation';
import { useState } from 'react';
import { ArrowRight, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';

const Homepage = () => {
  const [typingStatus, setTypingStatus] = useState('human1');

  return (
    <div className="relative h-full overflow-y-auto">
      <img
        src="/orbital.png"
        alt=""
        className="pointer-events-none absolute bottom-0 left-0 -z-10 opacity-5 [animation:rotateOrbital_100s_linear_infinite]"
      />

      <div className="mx-auto flex h-full max-w-6xl flex-col items-center gap-12 px-6 py-12 md:flex-row md:gap-16">
        <div className="flex flex-1 flex-col items-center gap-4 text-center md:items-start md:text-left">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-3 py-1 text-xs text-muted-foreground">
            <Sparkles className="size-3" />
            Multimodal · Local · Open
          </div>
          <h1 className="gradient-text text-5xl font-bold tracking-tight md:text-7xl">
            DORITOS AI
          </h1>
          <h2 className="text-xl font-medium md:text-2xl">
            Supercharge your creativity and productivity
          </h2>
          <p className="max-w-md text-muted-foreground">
            A self-hosted multimodal chat workspace powered by Qwen2-VL. Bring
            your own documents, ask anything, run everything on your machine.
          </p>
          <Button asChild size="lg" className="mt-3">
            <Link to="/dashboard">
              Get Started
              <ArrowRight className="size-4" />
            </Link>
          </Button>
        </div>

        <div className="flex flex-1 items-center justify-center">
          <div className="relative flex aspect-square w-full max-w-md items-center justify-center overflow-hidden rounded-3xl bg-[#140e2d]">
            <div className="absolute inset-0 overflow-hidden rounded-3xl">
              <div
                className="size-full opacity-20"
                style={{
                  backgroundImage: 'url(/bg.png)',
                  backgroundSize: 'auto 100%',
                  animation: 'slideBg 8s ease-in-out infinite alternate',
                }}
              />
            </div>
            <img
              src="/bot.png"
              alt=""
              className="size-full object-contain [animation:botAnimate_3s_ease-in-out_infinite_alternate]"
            />
            <div className="absolute -right-6 -bottom-6 hidden items-center gap-2.5 rounded-xl bg-card px-4 py-3 shadow-lg md:flex">
              <img
                src={
                  typingStatus === 'human1'
                    ? '/human1.jpeg'
                    : typingStatus === 'human2'
                    ? '/human2.jpeg'
                    : 'bot.png'
                }
                alt=""
                className="size-8 rounded-full object-cover"
              />
              <TypeAnimation
                sequence={[
                  'Human:We produce food for Mice',
                  2000,
                  () => setTypingStatus('bot'),
                  'Bot:We produce food for Hamsters',
                  2000,
                  () => setTypingStatus('human2'),
                  'Human2:We produce food for Guinea Pigs',
                  2000,
                  () => setTypingStatus('bot'),
                  'Bot:We produce food for Chinchillas',
                  2000,
                  () => setTypingStatus('human1'),
                ]}
                wrapper="span"
                className="text-sm"
                repeat={Infinity}
                cursor
                omitDeletionAnimation
              />
            </div>
          </div>
        </div>
      </div>

      <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 flex-col items-center gap-2 text-xs text-muted-foreground">
        <img src="/logo.png" alt="" className="size-4 opacity-60" />
        <div className="flex gap-2">
          <Link to="/" className="hover:text-foreground">Terms of Service</Link>
          <span>|</span>
          <Link to="/" className="hover:text-foreground">Privacy Policy</Link>
        </div>
      </div>
    </div>
  );
};

export default Homepage;
