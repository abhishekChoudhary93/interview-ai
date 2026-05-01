import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchMarketContext } from '@/api/market.js';

const STORAGE_KEY = 'interview-ai-preferred-market';

const MarketContext = createContext(null);

function readStoredPreferred() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v && ['US', 'EU', 'IN', 'ROW'].includes(v) ? v : null;
  } catch {
    return null;
  }
}

export function MarketProvider({ children }) {
  const queryClient = useQueryClient();
  const [preferredMarket, setPreferredMarketState] = useState(readStoredPreferred);

  const setPreferredMarket = useCallback(
    (id) => {
      const next =
        id === null || id === undefined || id === ''
          ? null
          : ['US', 'EU', 'IN', 'ROW'].includes(String(id).toUpperCase())
            ? String(id).toUpperCase()
            : null;
      try {
        if (next) localStorage.setItem(STORAGE_KEY, next);
        else localStorage.removeItem(STORAGE_KEY);
      } catch {
        /* ignore quota / private mode */
      }
      setPreferredMarketState(next);
      queryClient.invalidateQueries({ queryKey: ['market-context'] });
    },
    [queryClient]
  );

  const query = useQuery({
    queryKey: ['market-context', preferredMarket],
    queryFn: () => fetchMarketContext(preferredMarket),
    staleTime: 10 * 60 * 1000,
  });

  const value = useMemo(
    () => ({
      country: query.data?.country ?? null,
      marketId: query.data?.marketId ?? null,
      currency: query.data?.currency ?? null,
      currencySymbol: query.data?.currencySymbol ?? null,
      paymentProvider: query.data?.paymentProvider ?? null,
      pricing: query.data?.pricing ?? [],
      copy: query.data?.copy ?? null,
      isLoading: query.isLoading,
      isError: query.isError,
      error: query.error,
      refetch: query.refetch,
      preferredMarket,
      setPreferredMarket,
    }),
    [query.data, query.isLoading, query.isError, query.error, query.refetch, preferredMarket, setPreferredMarket]
  );

  return <MarketContext.Provider value={value}>{children}</MarketContext.Provider>;
}

export function useMarket() {
  const ctx = useContext(MarketContext);
  if (!ctx) throw new Error('useMarket must be used within MarketProvider');
  return ctx;
}
