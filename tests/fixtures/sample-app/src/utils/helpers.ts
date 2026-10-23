export function formatGreeting(name: string): string {
  const timestamp = new Date().toISOString();
  return `[${timestamp}] Hello, ${name.toUpperCase()}!`;
}

export function sanitizeInput(input: string): string {
  return input.trim().replace(/[<>]/g, '');
}
