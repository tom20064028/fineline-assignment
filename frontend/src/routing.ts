export type AppRoute = '/login' | '/workspace';

export function resolveRoute(_pathname: string, authenticated: boolean): AppRoute {
  // This app has one public page and one protected page. Unknown paths resolve
  // to the appropriate entry point without accepting arbitrary return URLs.
  return authenticated ? '/workspace' : '/login';
}
