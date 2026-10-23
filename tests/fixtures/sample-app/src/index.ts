import { AuthService } from '@/services/auth.js';
import { formatGreeting } from './utils/helpers.js';

export async function main(): Promise<void> {
  const auth = new AuthService();
  const user = await auth.login('test@example.com', 'supersecretpassword');
  if (user) {
    console.log(formatGreeting(user.username));
  }
}
