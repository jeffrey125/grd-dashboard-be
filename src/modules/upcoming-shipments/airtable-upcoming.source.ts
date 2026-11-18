import axios from 'axios';
import axiosRetry from 'axios-retry';
import Bottleneck from 'bottleneck';
import { z } from 'zod';
import type {
  AirtableRep,
  UpcomingOrder,
  UpcomingFileRecord,
  UpcomingSource,
} from './upcoming.contracts.js';

const base = 'appxyP3yY5YF9plDO';
const ordersTable = 'tbl7X5ROha1PzgGZt';
const repsTable = 'tblMqeGvgg4McO2hB';
const lineItemsTable = 'tblmLuTuX1RkziFOH';
const lineItemsField = 'GRD SALES ORDERS - Line Items';
const recordId = z.string().regex(/^rec[A-Za-z0-9]{14}$/);
const pageSchema = z.object({
  records: z.array(
    z.object({ id: recordId, fields: z.record(z.string(), z.unknown()) }),
  ),
  offset: z.string().optional(),
});
type RecordRow = z.infer<typeof pageSchema>['records'][number];
const textSchema = z.union([
  z.string(),
  z.number(),
  z.array(z.union([z.string(), z.number()])),
]);
const text = (value: unknown): string => {
  if (value == null) return '';
  const parsed = textSchema.parse(value);
  return Array.isArray(parsed) ? parsed.join(', ') : String(parsed);
};
const ids = (value: unknown): string[] =>
  value == null ? [] : z.array(recordId).parse(value);
const number = (value: unknown): number | null =>
  value == null ? null : z.number().finite().parse(value);
const lineNumbers = Array.from({ length: 10 }, (_, i) => i + 1);
const fields = [
  'REQ SHIP',
  'Test',
  'REP',
  'Customer - Name',
  'Customer PO',
  'SO',
  'Notes',
  'Tracking#',
  'Pallets',
  lineItemsField,
  ...lineNumbers.flatMap((i) => [
    `Product ${i}`,
    `Vendor ${i}`,
    `GRD PO ${i}`,
    `1. LBS ${i}`,
    `1. Units ${i}`,
    `FOB ${i}`,
  ]),
];

type ProductLinks = { productIds: string[]; vendorIds: string[] };

type LinkedProduct = ProductLinks & {
  lineItemId: string;
  orderIds: string[];
  purchaseOrder: string | null;
};

const productLinks = (
  fields: RecordRow['fields'],
  suffix = '',
): ProductLinks => ({
  productIds: ids(fields[`Product${suffix}`]),
  vendorIds: ids(fields[`Vendor${suffix}`]),
});

const sameLinks = (left: string[], right: string[]) =>
  left.length === right.length && left.every((id) => right.includes(id));

function matchPurchaseOrders(
  slots: Array<ProductLinks & { lineNumber: number }>,
  linked: LinkedProduct[],
) {
  const bySlot = new Map<number, string>();
  const additional: Array<LinkedProduct & { purchaseOrder: string }> = [];

  for (const line of linked) {
    if (line.purchaseOrder === null) continue;

    const sameProduct = (other: ProductLinks) =>
      line.productIds.length > 0 &&
      sameLinks(line.productIds, other.productIds);
    let candidates = slots.filter(sameProduct);
    let peers = linked.filter(sameProduct);

    // Airtable has no slot ID on the linked row. A repeated product needs
    // a unique vendor on both sides before its PO can be assigned to a slot.
    if (candidates.length !== 1 || peers.length !== 1) {
      const sameVendor = (other: ProductLinks) =>
        line.vendorIds.length > 0 && sameLinks(line.vendorIds, other.vendorIds);
      candidates = candidates.filter(sameVendor);
      peers = peers.filter(sameVendor);
    }

    if (candidates.length === 1 && peers.length === 1) {
      bySlot.set(candidates[0]!.lineNumber, line.purchaseOrder);
    } else {
      additional.push({ ...line, purchaseOrder: line.purchaseOrder });
    }
  }
  return { bySlot, additional };
}

export class AirtableUpcomingSource implements UpcomingSource {
  readonly configured: boolean;
  private readonly http;
  private readonly limiter = new Bottleneck({ maxConcurrent: 1, minTime: 220 });

  constructor(token?: string) {
    this.configured = Boolean(token);
    this.http = axios.create({
      baseURL: `https://api.airtable.com/v0/${base}/`,
      headers: { Authorization: `Bearer ${token ?? ''}` },
      timeout: 12_000,
      maxRedirects: 0,
    });
    axiosRetry(this.http, {
      retries: 2,
      retryDelay: axiosRetry.exponentialDelay,
      shouldResetTimeout: true,
      retryCondition: (error) =>
        error.response?.status === 429 ||
        axiosRetry.isNetworkOrIdempotentRequestError(error),
    });
  }

  async files(orderId: string): Promise<UpcomingFileRecord | null> {
    recordId.parse(orderId);
    const rows = await this.records(
      ordersTable,
      ['REQ SHIP', 'Test', 'REP', 'DOCS'],
      `RECORD_ID()='${orderId}'`,
    );
    const row = rows[0];
    if (!row) return null;
    const attachment = z.object({
      id: z.string().regex(/^att[A-Za-z0-9]+$/),
      filename: z.string(),
      size: z.number().nonnegative(),
      type: z.string().default('application/octet-stream'),
      url: z.url().refine((value) => {
        const url = new URL(value);
        return (
          url.protocol === 'https:' &&
          !url.username &&
          !url.password &&
          !url.port &&
          url.hostname.endsWith('.airtableusercontent.com')
        );
      }),
    });
    return {
      requestedShipOn:
        row.fields['REQ SHIP'] == null
          ? null
          : z.iso.date().parse(row.fields['REQ SHIP']),
      test: row.fields.Test === true,
      repIds: ids(row.fields.REP),
      files: z.array(attachment).parse(row.fields.DOCS ?? []),
    };
  }

  private async records(table: string, selected: string[], formula?: string) {
    if (!this.configured)
      throw new Error('Upcoming shipments are not configured');
    const rows: RecordRow[] = [];
    const offsets = new Set<string>();
    let offset: string | undefined;
    do {
      const params = new URLSearchParams({ pageSize: '100' });
      selected.forEach((field) => params.append('fields[]', field));
      if (formula) params.set('filterByFormula', formula);
      if (offset) params.set('offset', offset);
      const response = await this.limiter.schedule(() =>
        this.http.get<unknown>(table, { params }),
      );
      const page = pageSchema.parse(response.data);
      rows.push(...page.records);
      offset = page.offset;
      if (offset && (offsets.has(offset) || rows.length >= 10_000))
        throw new Error('Airtable result is incomplete');
      if (offset) offsets.add(offset);
    } while (offset);
    return rows;
  }

  async reps(): Promise<AirtableRep[]> {
    return (await this.records(repsTable, ['Name', 'Email']))
      .map(({ id, fields: row }) => ({
        id,
        name: text(row.Name) || 'Unnamed rep',
        email: text(row.Email).trim().toLowerCase() || null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  }

  private async linkedRecords(
    table: string,
    selected: string[],
    requested: string[],
  ) {
    const unique = [...new Set(requested)];
    const result: RecordRow[] = [];
    for (let i = 0; i < unique.length; i += 50) {
      const formula = `OR(${unique
        .slice(i, i + 50)
        .map((id) => `RECORD_ID()='${recordId.parse(id)}'`)
        .join(',')})`;
      result.push(...(await this.records(table, selected, formula)));
    }
    return result;
  }

  private async names(table: string, field: string, requested: string[]) {
    const rows = await this.linkedRecords(table, [field], requested);
    return new Map(rows.map((row) => [row.id, text(row.fields[field])]));
  }

  async load(from: string, through: string) {
    z.iso.date().parse(from);
    z.iso.date().parse(through);
    // Date-only values are compared to explicit Chicago dates, never Airtable's TODAY().
    const formula = `AND({REQ SHIP} != BLANK(), {REQ SHIP} >= '${from}', {REQ SHIP} <= '${through}', NOT({Test}))`;
    const rows = await this.records(ordersTable, fields, formula);
    const reps = await this.reps();
    const repNames = new Map(reps.map((rep) => [rep.id, rep.name]));
    const linkedRows = await this.linkedRecords(
      lineItemsTable,
      ['Type', 'GRD SALES ORDER', 'Product', 'Vendor', 'GRD PO'],
      rows.flatMap((row) => ids(row.fields[lineItemsField])),
    );
    const linkedProducts = new Map<string, LinkedProduct>();
    for (const { id, fields } of linkedRows) {
      if (fields.Type === 'Product Price') {
        linkedProducts.set(id, {
          lineItemId: id,
          ...productLinks(fields),
          orderIds: ids(fields['GRD SALES ORDER']),
          purchaseOrder: text(fields['GRD PO']) || null,
        });
      }
    }
    const linked = [...linkedProducts.values()];
    const products = await this.names(
      'tblN8r5UQEIBkXjqj',
      'Name',
      rows
        .flatMap(({ fields: f }) =>
          lineNumbers.flatMap((i) => ids(f[`Product ${i}`])),
        )
        .concat(linked.flatMap((line) => line.productIds)),
    );
    const vendors = await this.names(
      'tblBdoQM9R1D3XDhQ',
      'Vendor Name',
      rows
        .flatMap(({ fields: f }) =>
          lineNumbers.flatMap((i) => ids(f[`Vendor ${i}`])),
        )
        .concat(linked.flatMap((line) => line.vendorIds)),
    );
    const salesOrders = await this.names(
      'tblEbvMDHU0ThW0Yj',
      'GRD INVOICE',
      rows.flatMap(({ fields: f }) => ids(f.SO)),
    );
    const productName = (ids: string[]) =>
      ids.map((id) => products.get(id) || 'Unavailable product').join(', ') ||
      'Product unavailable';
    const vendorName = (ids: string[]) =>
      ids.map((id) => vendors.get(id) || 'Unavailable vendor').join(', ') ||
      'Vendor unavailable';

    const orders: UpcomingOrder[] = rows.flatMap(({ id, fields: f }) => {
      const date = z.iso.date().parse(f['REQ SHIP']);
      if (date < from || date > through || f.Test === true) return [];
      const repIds = ids(f.REP);
      const slots = lineNumbers.map((lineNumber) => ({
        lineNumber,
        ...productLinks(f, ` ${lineNumber}`),
      }));
      const ownLines = ids(f[lineItemsField]).flatMap((lineId) => {
        const line = linkedProducts.get(lineId);
        return line?.orderIds.includes(id) ? [line] : [];
      });
      const { bySlot, additional } = matchPurchaseOrders(slots, ownLines);
      return [
        {
          id,
          requestedShipOn: date,
          salesOrders: ids(f.SO).map(
            (id) => salesOrders.get(id) || 'Unavailable SO',
          ),
          customer: text(f['Customer - Name']) || 'Customer unavailable',
          customerPo: text(f['Customer PO']) || null,
          repIds,
          reps: repIds.map((id) => repNames.get(id) || 'Unavailable rep'),
          tracking: text(f['Tracking#']) || null,
          notes: text(f.Notes) || null,
          pallets: number(f.Pallets),
          additionalPurchaseOrders: additional.map((line) => ({
            lineItemId: line.lineItemId,
            product: productName(line.productIds),
            vendor: vendorName(line.vendorIds),
            purchaseOrder: line.purchaseOrder,
          })),
          lines: slots.flatMap(({ lineNumber: i, productIds, vendorIds }) => {
            const purchaseOrder =
              bySlot.get(i) ?? (text(f[`GRD PO ${i}`]) || null);
            const pounds = number(f[`1. LBS ${i}`]);
            const units = number(f[`1. Units ${i}`]);
            const origin = text(f[`FOB ${i}`]) || null;
            return productIds.length ||
              vendorIds.length ||
              purchaseOrder !== null ||
              pounds !== null ||
              units !== null ||
              origin
              ? [
                  {
                    lineNumber: i,
                    product: productName(productIds),
                    vendor: vendorName(vendorIds),
                    purchaseOrder,
                    pounds,
                    units,
                    origin,
                  },
                ]
              : [];
          }),
          airtableUrl: `https://airtable.com/${base}/${ordersTable}/${id}`,
        },
      ];
    });
    orders.sort(
      (a, b) =>
        a.requestedShipOn.localeCompare(b.requestedShipOn) ||
        a.id.localeCompare(b.id),
    );
    return { orders, reps, updatedAt: new Date().toISOString() };
  }
}
