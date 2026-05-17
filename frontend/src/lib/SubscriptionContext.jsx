import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import * as subscriptionApi from '@/api/subscription.js';
import { useAuth } from '@/lib/AuthContext';

const SubscriptionContext = createContext(null);

export function SubscriptionProvider({ children }) {
  const { isAuthenticated, authChecked } = useAuth();
  const [data, setData] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    if (!isAuthenticated) {
      setData(null);
      setError(null);
      return null;
    }
    setIsLoading(true);
    setError(null);
    try {
      const res = await subscriptionApi.fetchSubscription();
      setData(res);
      return res;
    } catch (e) {
      setError(e);
      setData(null);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (!authChecked) return;
    refresh();
  }, [authChecked, refresh]);

  const entitlements = data?.entitlements ?? null;

  return (
    <SubscriptionContext.Provider
      value={{
        data,
        entitlements,
        subscription: data?.subscription ?? null,
        usage: data?.usage ?? null,
        razorpayConfigured: data?.razorpayConfigured ?? false,
        isLoading,
        error,
        refresh,
      }}
    >
      {children}
    </SubscriptionContext.Provider>
  );
}

export function useSubscription() {
  const ctx = useContext(SubscriptionContext);
  if (!ctx) {
    throw new Error('useSubscription must be used within SubscriptionProvider');
  }
  return ctx;
}
