import { createClient } from '@base44/sdk';
import { appParams } from '@/lib/app-params';
import { isMockBase44 } from '@/lib/is-mock-base44';
import { mockBase44Client } from './mockBase44Client';

const { appId, token, functionsVersion, appBaseUrl } = appParams;

export const base44 = isMockBase44()
  ? mockBase44Client
  : createClient({
      appId,
      token,
      functionsVersion,
      serverUrl: '',
      requiresAuth: false,
      appBaseUrl
    });

