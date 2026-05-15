import React, { createContext, useState, useContext, useEffect, useCallback } from 'react';
import * as authApi from '@/api/auth.js';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [authChecked, setAuthChecked] = useState(false);

  const setSession = (me) => {
    setUser(me);
    setIsAuthenticated(true);
    setAuthChecked(true);
    return me;
  };

  const refreshUser = useCallback(async () => {
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
    return setSession(me);
  };

  const registerRequest = async (email, password, fullName) => {
    return authApi.registerRequest({ email, password, fullName });
  };

  const completeRegistration = async (email, code) => {
    const me = await authApi.registerVerify({ email, code });
    return setSession(me);
  };

  const sendLoginOtp = async (email) => {
    return authApi.sendLoginOtp({ email });
  };

  const verifyLoginOtp = async (email, code) => {
    const me = await authApi.verifyLoginOtp({ email, code });
    return setSession(me);
  };

  const logout = async () => {
    await authApi.logoutApi();
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
        registerRequest,
        completeRegistration,
        sendLoginOtp,
        verifyLoginOtp,
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
