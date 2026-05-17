import { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, CreditCard, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useSubscription } from '@/lib/SubscriptionContext';
import { useMarket } from '@/lib/MarketContext';
import { createRazorpayOrder, verifyRazorpayPayment } from '@/api/billing.js';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';

function loadRazorpayScript() {
  return new Promise((resolve, reject) => {
    if (window.Razorpay) {
      resolve(window.Razorpay);
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.onload = () => resolve(window.Razorpay);
    script.onerror = () => reject(new Error('Failed to load Razorpay'));
    document.body.appendChild(script);
  });
}

export default function Billing() {
  const { entitlements, subscription, usage, razorpayConfigured, refresh, isLoading } =
    useSubscription();
  const { paymentProvider, setPreferredMarket, marketId } = useMarket();
  const { toast } = useToast();
  const [payingPlan, setPayingPlan] = useState(null);

  const planLabel =
    entitlements?.effectivePlan === 'elite'
      ? 'Elite'
      : entitlements?.effectivePlan === 'pro'
        ? 'Pro'
        : 'Starter';

  const usageLabel =
    entitlements?.interviewsLimit == null
      ? `${entitlements?.interviewsUsed ?? 0} interviews used this month (unlimited)`
      : `${entitlements?.interviewsUsed ?? 0} of ${entitlements.interviewsLimit} interviews used this month`;

  const handleUpgrade = async (plan) => {
    if (!razorpayConfigured || paymentProvider !== 'razorpay') {
      toast({
        title: 'USD checkout coming soon',
        description: 'INR payments via Razorpay are available for India. Global checkout is on the way.',
      });
      return;
    }
    setPayingPlan(plan);
    try {
      const order = await createRazorpayOrder(plan);
      const Razorpay = await loadRazorpayScript();
      const rzp = new Razorpay({
        key: order.keyId,
        amount: order.amount,
        currency: order.currency,
        name: 'HireVerdict',
        description: plan === 'elite' ? 'Elite — monthly' : 'Pro — monthly',
        order_id: order.orderId,
        handler: async (response) => {
          try {
            await verifyRazorpayPayment({
              razorpay_order_id: response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature,
              plan,
            });
            await refresh();
            toast({
              title: 'Payment successful',
              description: `You're now on ${plan === 'elite' ? 'Elite' : 'Pro'}.`,
            });
          } catch (e) {
            toast({
              variant: 'destructive',
              title: 'Verification failed',
              description: e.message || 'Could not verify payment',
            });
          } finally {
            setPayingPlan(null);
          }
        },
        modal: {
          ondismiss: () => setPayingPlan(null),
        },
      });
      rzp.open();
    } catch (e) {
      setPayingPlan(null);
      toast({
        variant: 'destructive',
        title: 'Checkout failed',
        description: e.message || 'Could not start payment',
      });
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-accent" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <Link
        to="/dashboard"
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-8"
      >
        <ArrowLeft className="w-4 h-4" /> Back to dashboard
      </Link>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-card rounded-3xl border border-border/50 p-8 mb-8"
      >
        <div className="flex items-center gap-3 mb-4">
          <CreditCard className="w-6 h-6 text-accent" />
          <h1 className="font-space text-2xl font-bold">Billing & plan</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <Badge variant="secondary" className="text-sm">
            {planLabel}
          </Badge>
          {entitlements?.isActive && entitlements?.expiresAt ? (
            <span className="text-sm text-muted-foreground">
              {entitlements.daysRemaining != null
                ? `Renews in ${entitlements.daysRemaining} day(s)`
                : `Active until ${new Date(entitlements.expiresAt).toLocaleDateString()}`}
            </span>
          ) : null}
          {!entitlements?.isActive && subscription?.plan !== 'starter' ? (
            <Badge variant="outline" className="text-amber-600 border-amber-500/40">
              Expired — renew to unlock
            </Badge>
          ) : null}
        </div>
        <p className="text-sm text-muted-foreground">{usageLabel}</p>
        {usage?.periodKey ? (
          <p className="text-xs text-muted-foreground mt-1">Billing period: {usage.periodKey} (UTC)</p>
        ) : null}
      </motion.div>

      {/* Header and Sliding Currency Toggle Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6 mt-8">
        <h2 className="font-space text-lg font-bold">Available Upgrade Pathways</h2>
        
        <div className="relative flex p-0.5 bg-muted/65 border border-border/40 rounded-full backdrop-blur-md shadow-inner shadow-black/5">
          <button
            type="button"
            onClick={() => setPreferredMarket('US')}
            className={cn(
              "relative px-4 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-full transition-all duration-300 z-10 font-space",
              marketId !== 'IN' ? "text-accent-foreground font-semibold" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {marketId !== 'IN' && (
              <motion.div
                layoutId="activeMarketBilling"
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
              "relative px-4 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-full transition-all duration-300 z-10 font-space",
              marketId === 'IN' ? "text-accent-foreground font-semibold" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {marketId === 'IN' && (
              <motion.div
                layoutId="activeMarketBilling"
                className="absolute inset-0 bg-accent rounded-full -z-10 shadow-md shadow-accent/20"
                transition={{ type: "spring", stiffness: 380, damping: 30 }}
              />
            )}
            India (INR)
          </button>
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <PlanUpgradeCard
          name="Pro"
          price={paymentProvider === 'razorpay' ? '₹499/mo' : '$7.99/mo'}
          features={[
            '5 premium mock interviews/month',
            'Highly realistic & brutal feedback',
            'Custom role- & company-specific prep',
            'Full history & progress analytics'
          ]}
          highlight={entitlements?.effectivePlan === 'pro'}
          loading={payingPlan === 'pro'}
          onUpgrade={() => handleUpgrade('pro')}
          disabled={entitlements?.effectivePlan === 'pro' && entitlements?.isActive}
        />
        <PlanUpgradeCard
          name="Elite"
          price={paymentProvider === 'razorpay' ? '₹999/mo' : '$14.99/mo'}
          features={[
            'Unlimited premium mock interviews',
            'Comprehensive reports & suggestions',
            'System Design & Behavioral pathways',
            'Persistent canvas & history'
          ]}
          highlight={entitlements?.effectivePlan === 'elite'}
          loading={payingPlan === 'elite'}
          onUpgrade={() => handleUpgrade('elite')}
          disabled={entitlements?.effectivePlan === 'elite' && entitlements?.isActive}
        />
      </div>

      {paymentProvider !== 'razorpay' ? (
        <p className="text-center text-sm text-muted-foreground mt-8">
          USD card checkout is coming soon. India users can pay with UPI via Razorpay.
        </p>
      ) : !razorpayConfigured ? (
        <p className="text-center text-sm text-amber-600 mt-8">
          Razorpay keys are not configured on the server yet.
        </p>
      ) : null}
    </div>
  );
}

function PlanUpgradeCard({ name, price, features, highlight, loading, onUpgrade, disabled }) {
  return (
    <motion.div
      className={cn(
        "rounded-2xl border p-6 flex flex-col transition-all duration-300 bg-card/50 backdrop-blur-sm",
        highlight ? 'border-accent/40 ring-1 ring-accent/20 shadow-md shadow-accent/5' : 'border-border/50 hover:border-border/80'
      )}
    >
      <h2 className="font-space text-xl font-bold">{name}</h2>
      <p className="text-2xl font-black mt-1 mb-4 text-foreground">{price}</p>
      <ul className="text-sm text-muted-foreground space-y-2.5 flex-1 mb-6">
        {features.map((f) => (
          <li key={f} className="flex gap-2 items-start leading-tight">
            <span className="text-accent shrink-0 font-bold">✓</span>
            <span>{f}</span>
          </li>
        ))}
      </ul>
      <Button
        className={cn(
          "w-full rounded-xl font-medium font-space text-sm h-10",
          disabled ? "bg-muted text-muted-foreground hover:bg-muted" : "bg-accent hover:bg-accent/90 text-accent-foreground shadow-sm"
        )}
        onClick={onUpgrade}
        disabled={disabled || loading}
      >
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : disabled ? 'Current plan' : `Upgrade to ${name}`}
      </Button>
    </motion.div>
  );
}
