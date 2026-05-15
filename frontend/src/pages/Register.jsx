import { useState } from 'react';
import { Link, useNavigate, Navigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Mic } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';
import { useAuth } from '@/lib/AuthContext';

const formSchema = z
  .object({
    fullName: z.string().min(1, 'Name is required'),
    email: z.string().email(),
    password: z.string().min(8, 'At least 8 characters'),
    confirm: z.string(),
  })
  .refine((d) => d.password === d.confirm, { message: 'Passwords do not match', path: ['confirm'] });

const RESEND_COOLDOWN_SEC = 60;

export default function Register() {
  const navigate = useNavigate();
  const { registerRequest, completeRegistration, isAuthenticated, authChecked } = useAuth();
  const [step, setStep] = useState('form');
  const [pendingEmail, setPendingEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [error, setError] = useState('');
  const [resendCooldown, setResendCooldown] = useState(0);
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);

  if (authChecked && isAuthenticated) {
    return <Navigate to="/dashboard" replace />;
  }

  const form = useForm({
    resolver: zodResolver(formSchema),
    defaultValues: { fullName: '', email: '', password: '', confirm: '' },
  });

  const startResendCooldown = () => {
    setResendCooldown(RESEND_COOLDOWN_SEC);
    const id = setInterval(() => {
      setResendCooldown((s) => {
        if (s <= 1) {
          clearInterval(id);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
  };

  const onSubmitForm = async (values) => {
    setError('');
    try {
      await registerRequest(values.email, values.password, values.fullName);
      setPendingEmail(values.email);
      setStep('otp');
      setOtp('');
      startResendCooldown();
    } catch (e) {
      setError(e.message || 'Registration failed');
    }
  };

  const onResend = async () => {
    if (resendCooldown > 0 || sending) return;
    const values = form.getValues();
    setError('');
    setSending(true);
    try {
      await registerRequest(values.email, values.password, values.fullName);
      startResendCooldown();
    } catch (e) {
      setError(e.message || 'Could not resend code');
    } finally {
      setSending(false);
    }
  };

  const onVerifyOtp = async (e) => {
    e.preventDefault();
    if (otp.length !== 6) {
      setError('Enter the 6-digit code');
      return;
    }
    setError('');
    setVerifying(true);
    try {
      await completeRegistration(pendingEmail, otp);
      navigate('/dashboard', { replace: true });
    } catch (err) {
      setError(err.message || 'Verification failed');
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 bg-background">
      <Link to="/" className="flex items-center gap-2.5 mb-10">
        <div className="w-9 h-9 rounded-xl bg-accent flex items-center justify-center">
          <Mic className="w-5 h-5 text-accent-foreground" />
        </div>
        <span className="font-space font-bold text-lg tracking-tight">InterviewAI</span>
      </Link>
      <div className="w-full max-w-md space-y-6 rounded-2xl border border-border bg-card p-8 shadow-sm">
        {step === 'form' ? (
          <>
            <div>
              <h1 className="font-space text-2xl font-bold">Create account</h1>
              <p className="text-sm text-muted-foreground mt-1">Start tracking your interview practice.</p>
            </div>
            <form onSubmit={form.handleSubmit(onSubmitForm)} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="fullName">Full name</Label>
                <Input id="fullName" autoComplete="name" {...form.register('fullName')} className="h-11" />
                {form.formState.errors.fullName && (
                  <p className="text-sm text-destructive">{form.formState.errors.fullName.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" autoComplete="email" {...form.register('email')} className="h-11" />
                {form.formState.errors.email && (
                  <p className="text-sm text-destructive">{form.formState.errors.email.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="new-password"
                  {...form.register('password')}
                  className="h-11"
                />
                {form.formState.errors.password && (
                  <p className="text-sm text-destructive">{form.formState.errors.password.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm">Confirm password</Label>
                <Input
                  id="confirm"
                  type="password"
                  autoComplete="new-password"
                  {...form.register('confirm')}
                  className="h-11"
                />
                {form.formState.errors.confirm && (
                  <p className="text-sm text-destructive">{form.formState.errors.confirm.message}</p>
                )}
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button
                type="submit"
                className="w-full h-11 bg-accent text-accent-foreground font-semibold"
                disabled={form.formState.isSubmitting}
              >
                {form.formState.isSubmitting ? 'Sending code…' : 'Continue'}
              </Button>
            </form>
          </>
        ) : (
          <>
            <div>
              <h1 className="font-space text-2xl font-bold">Verify your email</h1>
              <p className="text-sm text-muted-foreground mt-1">
                We sent a 6-digit code to{' '}
                <span className="font-medium text-foreground">{pendingEmail}</span>
              </p>
            </div>
            <form onSubmit={onVerifyOtp} className="space-y-4">
              <div className="flex justify-center">
                <InputOTP maxLength={6} value={otp} onChange={setOtp}>
                  <InputOTPGroup>
                    {[0, 1, 2, 3, 4, 5].map((i) => (
                      <InputOTPSlot key={i} index={i} className="h-11 w-11" />
                    ))}
                  </InputOTPGroup>
                </InputOTP>
              </div>
              {error && <p className="text-sm text-destructive text-center">{error}</p>}
              <Button
                type="submit"
                className="w-full h-11 bg-accent text-accent-foreground font-semibold"
                disabled={otp.length !== 6 || verifying}
              >
                {verifying ? 'Verifying…' : 'Verify and create account'}
              </Button>
              <div className="flex flex-col items-center gap-2 text-sm">
                <button
                  type="button"
                  className="text-accent font-medium hover:underline disabled:opacity-50 disabled:no-underline"
                  disabled={resendCooldown > 0 || sending}
                  onClick={onResend}
                >
                  {resendCooldown > 0 ? `Resend code in ${resendCooldown}s` : 'Resend code'}
                </button>
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() => {
                    setStep('form');
                    setOtp('');
                    setError('');
                  }}
                >
                  Change email
                </button>
              </div>
            </form>
          </>
        )}
        <p className="text-center text-sm text-muted-foreground">
          Already have an account?{' '}
          <Link to="/login" className="text-accent font-medium hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}

