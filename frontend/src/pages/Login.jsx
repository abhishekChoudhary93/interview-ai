import { useState } from 'react';
import { Link, useNavigate, useLocation, Navigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Mic } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';
import { useAuth } from '@/lib/AuthContext';

const passwordSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1, 'Password is required'),
});

const otpEmailSchema = z.object({
  email: z.string().email(),
});

const RESEND_COOLDOWN_SEC = 60;

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const { login, sendLoginOtp, verifyLoginOtp, isAuthenticated, authChecked } = useAuth();
  const from = location.state?.from || '/dashboard';

  const [error, setError] = useState('');
  const [otpStep, setOtpStep] = useState('email');
  const [otpEmail, setOtpEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [resendCooldown, setResendCooldown] = useState(0);
  const [sendingOtp, setSendingOtp] = useState(false);
  const [verifyingOtp, setVerifyingOtp] = useState(false);

  const passwordForm = useForm({
    resolver: zodResolver(passwordSchema),
    defaultValues: { email: '', password: '' },
  });

  const otpEmailForm = useForm({
    resolver: zodResolver(otpEmailSchema),
    defaultValues: { email: '' },
  });

  if (authChecked && isAuthenticated) {
    return <Navigate to={from} replace />;
  }

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

  const onPasswordSubmit = async (values) => {
    setError('');
    try {
      await login(values.email, values.password);
      navigate(from, { replace: true });
    } catch (e) {
      setError(e.message || 'Login failed');
    }
  };

  const onSendOtp = async (values) => {
    setError('');
    setSendingOtp(true);
    try {
      await sendLoginOtp(values.email);
      setOtpEmail(values.email);
      setOtpStep('code');
      setOtp('');
      startResendCooldown();
    } catch (e) {
      setError(e.message || 'Could not send code');
    } finally {
      setSendingOtp(false);
    }
  };

  const onResendOtp = async () => {
    if (resendCooldown > 0 || sendingOtp) return;
    setError('');
    setSendingOtp(true);
    try {
      await sendLoginOtp(otpEmail);
      startResendCooldown();
    } catch (e) {
      setError(e.message || 'Could not resend code');
    } finally {
      setSendingOtp(false);
    }
  };

  const onVerifyOtp = async (e) => {
    e.preventDefault();
    if (otp.length !== 6) {
      setError('Enter the 6-digit code');
      return;
    }
    setError('');
    setVerifyingOtp(true);
    try {
      await verifyLoginOtp(otpEmail, otp);
      navigate(from, { replace: true });
    } catch (e) {
      setError(e.message || 'Verification failed');
    } finally {
      setVerifyingOtp(false);
    }
  };

  const resetOtpFlow = () => {
    setOtpStep('email');
    setOtp('');
    setError('');
    setResendCooldown(0);
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
        <div>
          <h1 className="font-space text-2xl font-bold">Sign in</h1>
          <p className="text-sm text-muted-foreground mt-1">Use your account to continue practicing.</p>
        </div>

        <Tabs defaultValue="password" className="w-full" onValueChange={resetOtpFlow}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="password">Password</TabsTrigger>
            <TabsTrigger value="code">Email code</TabsTrigger>
          </TabsList>

          <TabsContent value="password">
            <form onSubmit={passwordForm.handleSubmit(onPasswordSubmit)} className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label htmlFor="pw-email">Email</Label>
                <Input
                  id="pw-email"
                  type="email"
                  autoComplete="email"
                  {...passwordForm.register('email')}
                  className="h-11"
                />
                {passwordForm.formState.errors.email && (
                  <p className="text-sm text-destructive">{passwordForm.formState.errors.email.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  {...passwordForm.register('password')}
                  className="h-11"
                />
                {passwordForm.formState.errors.password && (
                  <p className="text-sm text-destructive">{passwordForm.formState.errors.password.message}</p>
                )}
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button
                type="submit"
                className="w-full h-11 bg-accent text-accent-foreground font-semibold"
                disabled={passwordForm.formState.isSubmitting}
              >
                {passwordForm.formState.isSubmitting ? 'Signing in…' : 'Sign in'}
              </Button>
            </form>
          </TabsContent>

          <TabsContent value="code">
            {otpStep === 'email' ? (
              <form onSubmit={otpEmailForm.handleSubmit(onSendOtp)} className="space-y-4 mt-4">
                <div className="space-y-2">
                  <Label htmlFor="otp-email">Email</Label>
                  <Input
                    id="otp-email"
                    type="email"
                    autoComplete="email"
                    {...otpEmailForm.register('email')}
                    className="h-11"
                  />
                  {otpEmailForm.formState.errors.email && (
                    <p className="text-sm text-destructive">{otpEmailForm.formState.errors.email.message}</p>
                  )}
                </div>
                {error && <p className="text-sm text-destructive">{error}</p>}
                <Button
                  type="submit"
                  className="w-full h-11 bg-accent text-accent-foreground font-semibold"
                  disabled={sendingOtp}
                >
                  {sendingOtp ? 'Sending…' : 'Send code'}
                </Button>
              </form>
            ) : (
              <form onSubmit={onVerifyOtp} className="space-y-4 mt-4">
                <p className="text-sm text-muted-foreground">
                  Code sent to <span className="font-medium text-foreground">{otpEmail}</span>
                </p>
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
                  disabled={otp.length !== 6 || verifyingOtp}
                >
                  {verifyingOtp ? 'Signing in…' : 'Sign in'}
                </Button>
                <div className="flex flex-col items-center gap-2 text-sm">
                  <button
                    type="button"
                    className="text-accent font-medium hover:underline disabled:opacity-50"
                    disabled={resendCooldown > 0 || sendingOtp}
                    onClick={onResendOtp}
                  >
                    {resendCooldown > 0 ? `Resend code in ${resendCooldown}s` : 'Resend code'}
                  </button>
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground"
                    onClick={resetOtpFlow}
                  >
                    Use a different email
                  </button>
                </div>
              </form>
            )}
          </TabsContent>
        </Tabs>

        <p className="text-center text-sm text-muted-foreground">
          No account?{' '}
          <Link to="/register" className="text-accent font-medium hover:underline">
            Register
          </Link>
        </p>
      </div>
    </div>
  );
}
