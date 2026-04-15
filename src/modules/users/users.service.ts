import { prisma } from '../../lib/prisma';
import { NotFoundError, ConflictError } from '../../types';
import { CreateUserInput, UpdateProfileInput } from './users.validators';

export async function createUser(data: CreateUserInput) {
  const existing = await prisma.user.findUnique({ where: { email: data.email } });

  if (existing) {
    throw new ConflictError('User with this email already exists');
  }

  return prisma.user.create({
    data: {
      googleId: data.googleId,
      email: data.email,
      firstName: data.firstName,
      lastName: data.lastName,
      institutionName: data.institutionName ?? null,
      phone: data.phone,
      occupations: data.occupations ?? [],
      marketingConsent: data.marketingConsent ?? true,
    },
  });
}

export async function getUserByGoogleId(googleId: string) {
  const user = await prisma.user.findUnique({ where: { googleId } });

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
