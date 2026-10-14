import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import axios from 'axios';
import { ProjectLogger } from '@infrastructure/logging/logging.types.js';
import {
  TrackingNotifications,
  type TrackingNotice,
} from './tracking-notifications.js';

function boundedMessage(message: string) {
  let result = '';
  let bytes = 0;
  for (const character of message) {
    bytes += Buffer.byteLength(character);
    if (bytes > 3400) return `${result}\n[Details truncated]`;
    result += character;
  }
  return result;
}

@Injectable()
export class NotificationsService
  extends TrackingNotifications
  implements OnModuleDestroy
{
  private readonly stopped = new AbortController();
  private readonly failures = new Set<string>();
  private readonly url?: string;
  private readonly client = axios.create({
    timeout: 15000,
    maxRedirects: 0,
    maxContentLength: 16384,
    maxBodyLength: 4096,
    proxy: false,
  });
  constructor(@Inject(ProjectLogger) private readonly logger: ProjectLogger) {
    super();
    const configured = process.env.NTFY_URL?.trim();
    if (configured) {
      try {
        const url = new URL(configured);
        if (
          !['http:', 'https:'].includes(url.protocol) ||
          url.username ||
          url.password ||
          url.hash ||
          url.search
        )
          throw new Error();
        this.url = url.toString();
      } catch {
        throw new Error(
          'Invalid NTFY_URL: use an HTTP(S) topic URL without credentials, query, or fragment',
        );
      }
    }
  }
  async record(notice: TrackingNotice): Promise<void> {
    if (this.stopped.signal.aborted) return;
    const fields = {
      carrierCode: notice.carrierCode,
      shipmentExternalId: notice.shipmentExternalId,
    };
    try {
      let title: string;
      let detail: string;
      if (notice.outcome === 'failed') {
        if (this.failures.has(notice.carrierCode)) return;
        this.failures.add(notice.carrierCode);
        title = 'Carrier check incomplete';
        detail =
          'Tracking check failed. Monitoring has not been stopped by this failure.';
      } else {
        // A confirmed not-found response also demonstrates a functioning lookup.
        this.failures.delete(notice.carrierCode);
        if (notice.stopped) {
          title = 'Shipment monitoring stopped';
          detail =
            notice.stopped === 'delivered'
              ? 'Monitoring stopped: shipment delivered.'
              : 'Monitoring stopped: consecutive not-found threshold reached.';
        } else if (notice.outcome === 'found' && notice.changed) {
          title = notice.initial
            ? 'Initial tracking result'
            : 'Shipment changes';
          detail = notice.initial
            ? 'First tracking result.'
            : 'Tracking details changed.';
        } else return;
        if (notice.snapshot) {
          for (const [key, value] of Object.entries(notice.snapshot)) {
            if (
              notice.previous &&
              notice.previous[key as keyof typeof notice.previous] === value
            )
              continue;
            detail += `\n${key}: ${notice.previous ? `${notice.previous[key as keyof typeof notice.previous] ?? 'unknown'} -> ` : ''}${value ?? 'unknown'}`;
          }
        }
      }
      if (!this.url) return;
      await this.client.post(
        this.url,
        boundedMessage(
          `Shipment: ${notice.trackingReference}\nCarrier: ${notice.carrierCode}\n${detail}`,
        ),
        {
          headers: {
            Title: title,
            'Content-Type': 'text/plain; charset=utf-8',
          },
          signal: AbortSignal.any([
            this.stopped.signal,
            AbortSignal.timeout(15000),
          ]),
        },
      );
      this.logger.info(
        'notification.published',
        'Tracking notification published',
        fields,
      );
    } catch {
      // Never pass Axios errors: they contain the topic URL, body and credentials.
      this.logger.warn(
        'notification.discarded',
        'Tracking notification could not be published and was discarded',
        fields,
      );
    }
  }
  onModuleDestroy() {
    this.stopped.abort();
  }
}
