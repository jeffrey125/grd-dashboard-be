import type { Page, Request } from 'playwright';
import { z } from 'zod';

const alertFetch = z
  .object({ request: z.object({ mode: z.literal('FETCH') }).passthrough() })
  .passthrough();

function isAlertFetch(request: Request): boolean {
  try {
    return alertFetch.safeParse(request.postDataJSON()).success;
  } catch {
    return false;
  }
}

/** Installed before navigation: readiness may authenticate/read, never request rates or mutate provider data. */
export async function guardReadinessPage(page: Page, origin: string) {
  const readOnlyPosts = new Set([
    '/hz/getLatestProposalSharedWithShipper',
    '/svc/getUserProfileFlow',
    '/svc/getNotificationCountFlow',
    '/svc/getNotificationListFlow',
    '/svc/getSystemNotificationsFlow',
    '/svc/getDynamicEntityFlow',
    '/svc/getShippingAddressFlow',
    '/svc/getAddressLocationFlow',
    '/svc/getCountryDivisionMappingFlow',
    '/svc/getCountryListFlow',
    '/svc/getValidCitiesForPostalCodeFlow',
    '/svc/searchIndexDocumentFlow',
  ]);
  const authOrigins = new Set([
    origin,
    ...(origin.includes('amazon')
      ? ['https://www.amazon.com']
      : ['https://auth.myunishippers.com', 'https://auth.unishippers.com']),
  ]);
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (
      /\/shipping-rates\/getRates|\/svc\/(?:shopFlow|orderFlow|schedulePickupFlow)/.test(
        url.pathname,
      )
    ) {
      await route.abort();
      return;
    }
    const read = ['GET', 'HEAD', 'OPTIONS'].includes(request.method());
    const allowedPost =
      request.method() === 'POST' &&
      ((url.origin === origin &&
        (readOnlyPosts.has(url.pathname) ||
          (url.pathname === '/svc/setAlertFlow' && isAlertFetch(request)))) ||
        (authOrigins.has(url.origin) &&
          /^(?:\/ap\/signin|\/aaut\/verify\/cvf\/?|\/u\/login(?:\/(?:identifier|password))?|\/usernamepassword\/login|\/oauth\/token)$/.test(
            url.pathname,
          )));
    if (read || allowedPost) await route.fallback();
    else await route.abort();
  });
}
