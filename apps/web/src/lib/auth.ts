import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  startRegistration,
  startAuthentication,
  type RegistrationResponseJSON,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser';
import { api, type AuthState } from './api.js';

const AUTH_KEY = ['auth', 'state'] as const;

export function useAuthState() {
  return useQuery({
    queryKey: AUTH_KEY,
    queryFn: () => api.get<AuthState>('/api/auth/state'),
    staleTime: 5_000,
  });
}

export function useRegisterPasskey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (deviceName: string) => {
      const opts = await api.post<PublicKeyCredentialCreationOptionsJSON>(
        '/api/auth/register/begin',
        { deviceName },
      );
      const att: RegistrationResponseJSON = await startRegistration({ optionsJSON: opts });
      return api.post<{ ok: true; userId: number }>('/api/auth/register/finish', {
        response: att,
        deviceName,
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: AUTH_KEY }),
  });
}

export function useLoginPasskey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const opts = await api.post<PublicKeyCredentialRequestOptionsJSON>('/api/auth/login/begin');
      const assertion: AuthenticationResponseJSON = await startAuthentication({ optionsJSON: opts });
      return api.post<{ ok: true; userId: number }>('/api/auth/login/finish', { response: assertion });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: AUTH_KEY }),
  });
}

export function useEnrollPasskey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (deviceName: string) => {
      const opts = await api.post<PublicKeyCredentialCreationOptionsJSON>(
        '/api/auth/enroll/begin',
        { deviceName },
      );
      const att: RegistrationResponseJSON = await startRegistration({ optionsJSON: opts });
      return api.post<{ ok: true; credentialId: string }>('/api/auth/enroll/finish', {
        response: att,
        deviceName,
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: AUTH_KEY }),
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post('/api/auth/logout'),
    onSuccess: () => qc.invalidateQueries({ queryKey: AUTH_KEY }),
  });
}
