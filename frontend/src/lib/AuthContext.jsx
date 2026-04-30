import React, { createContext, useState, useContext, useEffect, useCallback } from 'react';
import { getToken } from '@/lib/authToken.js';
import * as authApi from '@/api/auth.js';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [authChecked, setAuthChecked] = useState(false);

  const refreshUser = useCallback(async () => {
    const token = getToken();
    if (!token) {
      setUser(null);
      setIsAuthenticated(false);
      setIsLoadingAuth(false);
      setAuthChecked(true);
      return;
    }
    setIsLoadingAuth(true);
    try {
      const me = await authApi.fetchMe();
      setUser(me);
      setIsAuthenticated(true);
    } catch {
      authApi.logoutClient();
      setUser(null);
      setIsAuthenticated(false);
    } finally {
      setIsLoadingAuth(false);
      setAuthChecked(true);
    }
  }, []);

  useEffect(() => {
    refreshUser();
  }, [refreshUser]);

  const login = async (email, password) => {
    const me = await authApi.login({ email, password });
    setUser(me);
    setIsAuthenticated(true);
    setAuthChecked(true);
    return me;
  };

  const register = async (email, password, fullName) => {
    const me = await authApi.register({ email, password, fullName });
    setUser(me);
    setIsAuthenticated(true);
    setAuthChecked(true);
    return me;
  };

  const logout = () => {
    authApi.logoutClient();
    setUser(null);
    setIsAuthenticated(false);
    setAuthChecked(true);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated,
        isLoadingAuth,
        authChecked,
        login,
        register,
        logout,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
