import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { useMarket } from '@/lib/MarketContext';
import { cn } from '@/lib/utils';
import { ArrowRight, Check } from 'lucide-react';

function ctaLabel(tierId) {
  if (tierId === 'starter') return 'Start free';
  if (tierId === 'pro_monthly') return 'Get Pro';
  if (tierId === 'elite_monthly') return 'Get Elite';
  return 'Get started';
}

function tierCtaHref(tierId, isAuthenticated) {
  if (tierId === 'starter') return '/register';
  return isAuthenticated ? '/billing' : '/register';
}

export default function PricingSection() {
  const { copy, pricing, isLoading, isError, refetch, preferredMarket, setPreferredMarket, marketId } = useMarket();
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();

  return (
    <section id="pricing" className="py-24 lg:py-32 scroll-mt-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-8"
        >
          <p className="text-accent font-semibold text-sm tracking-wide uppercase mb-3">Pricing</p>
          <h2 className="font-space text-3xl sm:text-4xl font-bold tracking-tight">
            {isLoading ? 'Plans' : copy?.pricingTitle ?? 'Plans'}
          </h2>
          <p className="mt-4 text-muted-foreground max-w-xl mx-auto text-sm sm:text-base leading-relaxed">
            {isLoading ? 'Loading plans…' : copy?.pricingSubtitle ?? ''}
          </p>
        </motion.div>

        {/* Premium Sliding Region/Currency Selector Toggle */}
        <div className="flex justify-center mb-16">
          <div className="relative flex p-1 bg-muted/65 border border-border/40 rounded-full backdrop-blur-md shadow-inner shadow-black/10">
            <button
              type="button"
              onClick={() => setPreferredMarket('US')}
              className={cn(
                "relative px-6 py-2 text-xs font-bold uppercase tracking-wider rounded-full transition-all duration-300 z-10 font-space",
                marketId !== 'IN' ? "text-accent-foreground font-semibold" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {marketId !== 'IN' && (
                <motion.div
                  layoutId="activeMarketLanding"
                  className="absolute inset-0 bg-accent rounded-full -z-10 shadow-md shadow-accent/20"
                  transition={{ type: "spring", stiffness: 380, damping: 30 }}
                />
              )}
              Global (USD)
            </button>
            <button
              type="button"
              onClick={() => setPreferredMarket('IN')}
              className={cn(
                "relative px-6 py-2 text-xs font-bold uppercase tracking-wider rounded-full transition-all duration-300 z-10 font-space",
                marketId === 'IN' ? "text-accent-foreground font-semibold" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {marketId === 'IN' && (
                <motion.div
                  layoutId="activeMarketLanding"
                  className="absolute inset-0 bg-accent rounded-full -z-10 shadow-md shadow-accent/20"
                  transition={{ type: "spring", stiffness: 380, damping: 30 }}
                />
              )}
              India (INR)
            </button>
          </div>
        </div>

        {isError ? (
          <div className="text-center text-sm text-destructive mb-8">
            Could not load pricing.{' '}
            <button type="button" className="underline underline-offset-2" onClick={() => refetch()}>
              Retry
            </button>
          </div>
        ) : null}

        <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto items-stretch">
          {isLoading
            ? [0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="rounded-3xl border border-border/50 bg-muted/30 h-[400px] animate-pulse"
                />
              ))
            : pricing.map((tier, i) => (
                <motion.div
                  key={tier.id}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.1 }}
                  className="flex flex-col h-full"
                >
                  <Card
                    className={cn(
                      'h-full flex flex-col border-border/50 overflow-visible relative rounded-3xl transition-all duration-300 hover:border-border hover:shadow-xl hover:shadow-black/5 bg-card/60 backdrop-blur-sm',
                      tier.highlight &&
                        'border-accent/40 shadow-xl shadow-accent/5 ring-1 ring-accent/20'
                    )}
                  >
                    {tier.highlight ? (
                      <div className="absolute top-0 right-8 -translate-y-1/2">
                        <Badge className="bg-accent text-accent-foreground border-none font-bold px-3 py-1 text-[10px] tracking-widest uppercase shadow-md shadow-accent/15 rounded-full">
                          Popular
                        </Badge>
                      </div>
                    ) : null}

                    <CardHeader className="pt-8 pb-6 px-6">
                      <CardTitle className="font-space text-2xl font-bold tracking-tight text-foreground">{tier.name}</CardTitle>
                      <CardDescription className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0 pt-2">
                        <span className="font-space text-3xl font-extrabold text-foreground tracking-tight">
                          {tier.amountDisplay}
                        </span>
                        <span className="text-sm font-medium text-muted-foreground">{tier.intervalLabel}</span>
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="flex-1 px-6 pb-6 pt-0">
                      <ul className="space-y-3.5 text-sm text-muted-foreground">
                        {tier.features.map((f) => (
                          <li key={f} className="flex gap-3 items-start leading-tight">
                            <span className="w-4 h-4 rounded-full bg-accent/10 border border-accent/20 flex items-center justify-center text-accent shrink-0 mt-0.5">
                              <Check className="w-2.5 h-2.5" />
                            </span>
                            <span>{f}</span>
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                    <CardFooter className="p-6 pt-0">
                      <Button
                        type="button"
                        className={cn(
                          'w-full rounded-2xl gap-2 h-11 font-medium font-space text-sm transition-all duration-300',
                          tier.highlight 
                            ? 'bg-accent hover:bg-accent/90 text-accent-foreground shadow-md shadow-accent/10 hover:shadow-lg hover:shadow-accent/15' 
                            : 'hover:bg-muted/80'
                        )}
                        variant={tier.highlight ? 'default' : 'outline'}
                        onClick={() => navigate(tierCtaHref(tier.id, isAuthenticated))}
                      >
                        {ctaLabel(tier.id)}
                        <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
                      </Button>
                    </CardFooter>
                  </Card>
                </motion.div>
              ))}
        </div>
      </div>
    </section>
  );
}
