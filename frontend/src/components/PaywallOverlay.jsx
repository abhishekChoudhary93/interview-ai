import { Link } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function PaywallOverlay({
  title = 'Unlock the full report',
  description = 'Upgrade to Pro or Elite to see the brutal breakdown, signal-level evidence, and transcript.',
  ctaLabel = 'View plans',
  ctaTo = '/billing',
  children,
}) {
  return (
    <div className="relative rounded-2xl overflow-hidden min-h-[12rem]">
      {children ? (
        <div className="pointer-events-none select-none blur-sm opacity-40 max-h-48 overflow-hidden">
          {children}
        </div>
      ) : null}
      <div className="absolute inset-0 z-10 flex flex-col items-center justify-center p-6 text-center bg-background/80 backdrop-blur-md border border-border/50 rounded-2xl">
        <div className="w-12 h-12 rounded-full bg-accent/15 flex items-center justify-center mb-4">
          <Lock className="w-6 h-6 text-accent" />
        </div>
        <h3 className="font-space text-lg font-semibold mb-2">{title}</h3>
        <p className="text-sm text-muted-foreground max-w-md mb-5">{description}</p>
        <Link to={ctaTo}>
          <Button className="bg-accent hover:bg-accent/90 text-accent-foreground rounded-xl">
            {ctaLabel}
          </Button>
        </Link>
      </div>
    </div>
  );
}
