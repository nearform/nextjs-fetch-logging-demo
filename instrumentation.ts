
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { setupFetchInterceptor } = await import('./lib/fetch-interceptor');
    setupFetchInterceptor();
  }
}
