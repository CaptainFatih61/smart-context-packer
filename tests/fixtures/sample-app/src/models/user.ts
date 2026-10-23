export interface User {
  id: string;
  username: string;
  email: string;
  role: 'admin' | 'user';
  createdAt: Date;
}

export function validateUser(user: User): boolean {
  return Boolean(user.id && user.email.includes('@'));
}
