import { PrismaClient } from '@prisma/client';
import type { User } from '@prisma/client';

const prisma = new PrismaClient();

export async function getUserWithPosts(id: string): Promise<User | null> {
  return prisma.user.findUnique({
    where: { id },
    include: { posts: true },
  });
}
