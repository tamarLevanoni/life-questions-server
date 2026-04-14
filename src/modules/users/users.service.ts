import { prisma } from '../../lib/prisma';
import { NotFoundError } from '../../types';
import { SyncUserInput, UpdateProfileInput } from './users.validators';

export async function syncUser(data: SyncUserInput) {
  const user = await prisma.user.upsert({
    where: { email: data.email },
    create: {
      id: data.id,
      email: data.email,
      firstName: data.firstName,
      lastName: data.lastName,
      institutionName: data.institutionName ?? null,
      phone: data.phone,
      occupations: data.occupations ?? [],
      marketingConsent: data.marketingConsent ?? true,
    },
    update: {
      // Only refresh identity-confirming fields from OAuth on re-login.
      // User-controlled fields (phone, occupations, institutionName) are NOT
      // overwritten here — they are managed exclusively via PATCH /profile/:id.
      firstName: data.firstName,
      lastName: data.lastName,
    },
  });

  return user;
}

export async function getUserById(id: string) {
  const user = await prisma.user.findUnique({ where: { id } });

  if (!user) {
    throw new NotFoundError('User');
  }

  return user;
}

export async function updateUserProfile(id: string, data: UpdateProfileInput) {
  const existing = await prisma.user.findUnique({ where: { id } });

  if (!existing) {
    throw new NotFoundError('User');
  }

  const updated = await prisma.user.update({
    where: { id },
    data,
  });

  return updated;
}
