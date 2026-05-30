import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
  AuthenticatorTransportFuture,
} from '@simplewebauthn/server';
import { db } from '../db/client.js';
import { config } from '../config.js';

const MAX_CREDENTIALS = 4;

type UserRow = { id: number; name: string | null; created_at: number };
type CredRow = {
  id: string;
  user_id: number;
  public_key: Buffer;
  counter: number;
  transports: string | null;
  device_name: string | null;
};

const countUsers = db.prepare('SELECT COUNT(*) AS n FROM users');
const insertUser = db.prepare('INSERT INTO users (name, created_at) VALUES (?, ?) RETURNING id');
const firstUser = db.prepare('SELECT * FROM users ORDER BY id ASC LIMIT 1');
const credsByUser = db.prepare('SELECT * FROM credentials WHERE user_id = ? ORDER BY id ASC');
const credById = db.prepare('SELECT * FROM credentials WHERE id = ?');
const insertCred = db.prepare(`
  INSERT INTO credentials (id, user_id, public_key, counter, transports, device_name, created_at)
  VALUES (@id, @user_id, @public_key, @counter, @transports, @device_name, @now)
`);
const updateCounter = db.prepare('UPDATE credentials SET counter = ?, last_used_at = ? WHERE id = ?');

export function userCount(): number {
  return (countUsers.get() as { n: number }).n;
}

export function getFirstUser(): UserRow | undefined {
  return firstUser.get() as UserRow | undefined;
}

export function listCredentials(userId: number): CredRow[] {
  return credsByUser.all(userId) as CredRow[];
}

export const rpName = config.RP_NAME;
export const rpID = config.RP_ID;
export const expectedOrigin = config.PUBLIC_URL.replace(/\/+$/, '');

// ----- Registration -----

export async function startRegistration(deviceName: string) {
  const existingUsers = userCount();
  if (existingUsers > 0) {
    throw new Error('user already exists — use enroll while authenticated');
  }
  const tempUserId = 'pending';
  const opts = await generateRegistrationOptions({
    rpName,
    rpID,
    userName: deviceName || 'Perflix Owner',
    userID: new TextEncoder().encode(tempUserId),
    attestationType: 'none',
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred',
    },
    supportedAlgorithmIDs: [-7, -257],
  });
  return opts;
}

export async function finishRegistration(
  response: RegistrationResponseJSON,
  expectedChallenge: string,
  deviceName: string,
): Promise<{ userId: number; credentialId: string }> {
  const result = await verifyRegistrationResponse({
    response,
    expectedChallenge,
    expectedOrigin,
    expectedRPID: rpID,
    requireUserVerification: false,
  });
  if (!result.verified || !result.registrationInfo) {
    throw new Error('registration not verified');
  }
  const credential = result.registrationInfo.credential;

  const userRow = insertUser.get('Owner', Date.now()) as { id: number };
  insertCred.run({
    id: credential.id,
    user_id: userRow.id,
    public_key: Buffer.from(credential.publicKey),
    counter: credential.counter,
    transports: credential.transports?.join(',') ?? null,
    device_name: deviceName || null,
    now: Date.now(),
  });
  return { userId: userRow.id, credentialId: credential.id };
}

// ----- Enroll additional credential while authenticated -----

export async function startEnrollment(userId: number, deviceName: string) {
  const existing = listCredentials(userId);
  if (existing.length >= MAX_CREDENTIALS) {
    throw new Error(`max ${MAX_CREDENTIALS} credentials reached`);
  }
  const opts = await generateRegistrationOptions({
    rpName,
    rpID,
    userName: deviceName || `Device ${existing.length + 1}`,
    userID: new TextEncoder().encode(String(userId)),
    attestationType: 'none',
    excludeCredentials: existing.map((c) => ({
      id: c.id,
      transports: (c.transports?.split(',').filter(Boolean) ?? []) as AuthenticatorTransportFuture[],
    })),
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred',
    },
    supportedAlgorithmIDs: [-7, -257],
  });
  return opts;
}

export async function finishEnrollment(
  userId: number,
  response: RegistrationResponseJSON,
  expectedChallenge: string,
  deviceName: string,
): Promise<{ credentialId: string }> {
  const result = await verifyRegistrationResponse({
    response,
    expectedChallenge,
    expectedOrigin,
    expectedRPID: rpID,
    requireUserVerification: false,
  });
  if (!result.verified || !result.registrationInfo) {
    throw new Error('enrollment not verified');
  }
  const credential = result.registrationInfo.credential;
  insertCred.run({
    id: credential.id,
    user_id: userId,
    public_key: Buffer.from(credential.publicKey),
    counter: credential.counter,
    transports: credential.transports?.join(',') ?? null,
    device_name: deviceName || null,
    now: Date.now(),
  });
  return { credentialId: credential.id };
}

// ----- Authentication -----

export async function startAuthentication() {
  const user = getFirstUser();
  if (!user) throw new Error('no users registered');
  const creds = listCredentials(user.id);
  const opts = await generateAuthenticationOptions({
    rpID,
    allowCredentials: creds.map((c) => ({
      id: c.id,
      transports: (c.transports?.split(',').filter(Boolean) ?? []) as AuthenticatorTransportFuture[],
    })),
    userVerification: 'preferred',
  });
  return { options: opts, userId: user.id };
}

export async function finishAuthentication(
  response: AuthenticationResponseJSON,
  expectedChallenge: string,
): Promise<{ userId: number }> {
  const cred = credById.get(response.id) as CredRow | undefined;
  if (!cred) throw new Error('unknown credential');
  const result = await verifyAuthenticationResponse({
    response,
    expectedChallenge,
    expectedOrigin,
    expectedRPID: rpID,
    credential: {
      id: cred.id,
      publicKey: new Uint8Array(cred.public_key),
      counter: cred.counter,
      transports: (cred.transports?.split(',').filter(Boolean) ?? []) as AuthenticatorTransportFuture[],
    },
    requireUserVerification: false,
  });
  if (!result.verified) throw new Error('authentication failed');
  updateCounter.run(result.authenticationInfo.newCounter, Date.now(), cred.id);
  return { userId: cred.user_id };
}
