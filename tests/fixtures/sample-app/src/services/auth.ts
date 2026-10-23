import type { User } from '@/models/user.js';
import { validateUser } from '@/models/user.js';
import { sanitizeInput } from '@/utils/helpers.js';

export class AuthService {
  private secretToken = 'sk-mock-authservice-token-secret-12345';

  public async login(email: string, pass: string): Promise<User | null> {
    const cleanEmail = sanitizeInput(email);
    const mockUser: User = {
      id: 'usr_1',
      username: 'johndoe',
      email: cleanEmail,
      role: 'admin',
      createdAt: new Date(),
    };

    if (validateUser(mockUser) && pass.length > 5) {
      return mockUser;
    }
    return null;
  }
}
