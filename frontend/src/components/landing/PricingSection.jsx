import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { useMarket } from '@/lib/MarketContext';
import { cn } from '@/lib/utils';
import { ArrowRight } from 'lucide-react';

function ctaLabel(tierId) {
  if (tierId === 'free_trial') return 'Start free trial';
  if (tierId === 'pro_monthly') return 'Get Pro';
  return 'Get started';
}

export default function PricingSection() {
  const { copy, pricing, isLoading, isError, refetch } = useMarket();

  return (
    <section id="pricing" className="py-24 lg:py-32 scroll-mt-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-12"
        >
          <p className="text-accent font-semibold text-sm tracking-wide uppercase mb-3">Pricing</p>
          <h2 className="font-space text-3xl sm:text-4xl font-bold tracking-tight">
            {isLoading ? 'Plans' : copy?.pricingTitle ?? 'Plans'}
          </h2>
          <p className="mt-4 text-muted-foreground max-w-xl mx-auto">
            {isLoading ? 'Loading plans…' : copy?.pricingSubtitle ?? ''}
          </p>
        </motion.div>

        {isError ? (
          <div className="text-center text-sm text-destructive mb-8">
            Could not load pricing.{' '}
            <button type="button" className="underline underline-offset-2" onClick={() => refetch()}>
              Retry
            </button>
          </div>
        ) : null}

        <div className="grid md:grid-cols-2 gap-8 max-w-4xl mx-auto">
          {isLoading
            ? [0, 1].map((i) => (
                <div
                  key={i}
                  className="rounded-xl border border-border/50 bg-muted/30 h-[340px] animate-pulse"
                />
              ))
            : pricing.map((tier, i) => (
                <motion.div
                  key={tier.id}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.1 }}
                >
                  <Card
                    className={cn(
                      'h-full flex flex-col border-border/50 overflow-hidden',
                      tier.highlight &&
                        'border-accent/40 shadow-lg shadow-accent/10 ring-1 ring-accent/20'
                    )}
                  >
                    <CardHeader>
                      {tier.highlight ? (
                        <Badge className="w-fit mb-2 bg-accent text-accent-foreground">Popular</Badge>
                      ) : null}
                      <CardTitle className="font-space text-2xl">{tier.name}</CardTitle>
                      <CardDescription className="flex flex-wrap items-baseline gap-x-1 gap-y-0 pt-2">
                        <span className="font-space text-3xl font-bold text-foreground">
                          {tier.amountDisplay}
                        </span>
                        <span className="text-muted-foreground">{tier.intervalLabel}</span>
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="flex-1">
                      <ul className="space-y-2 text-sm text-muted-foreground">
                        {tier.features.map((f) => (
                          <li key={f} className="flex gap-2">
                            <span className="text-accent mt-0.5 shrink-0">✓</span>
                            <span>{f}</span>
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                    <CardFooter>
                      <Link to="/register" className="w-full">
                        <Button
                          className={cn(
                            'w-full rounded-xl gap-2',
                            tier.highlight ? 'bg-accent hover:bg-accent/90 text-accent-foreground' : ''
                          )}
                          variant={tier.highlight ? 'default' : 'outline'}
                        >
                          {ctaLabel(tier.id)}
                          <ArrowRight className="w-4 h-4" />
                        </Button>
                      </Link>
                    </CardFooter>
                  </Card>
                </motion.div>
              ))}
        </div>
      </div>
    </section>
  );
}
