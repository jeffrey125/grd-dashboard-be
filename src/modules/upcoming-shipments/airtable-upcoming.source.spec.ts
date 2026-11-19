import axios from 'axios';
import { afterEach, expect, it } from 'vitest';
import { AirtableUpcomingSource } from './airtable-upcoming.source.js';

const adapter = axios.defaults.adapter;
afterEach(() => {
  axios.defaults.adapter = adapter;
});

it('paginates bounded requested dates, resolves operational links, and preserves PO zero', async () => {
  const calls: Array<{ url: string; params: URLSearchParams }> = [];
  axios.defaults.adapter = async (config) => {
    const params = config.params as URLSearchParams;
    const url = config.url ?? '';
    calls.push({ url, params });
    let data: unknown = { records: [] };
    if (url === 'tbl7X5ROha1PzgGZt')
      data = params.has('offset')
        ? { records: [] }
        : {
            offset: 'next-page',
            records: [
              {
                id: 'recAAAAAAAAAAAAAA',
                fields: {
                  'REQ SHIP': '2026-11-17',
                  REP: ['recBBBBBBBBBBBBBB'],
                  'Customer - Name': ['Fixture customer'],
                  'GRD PO 1': 0,
                  '1. LBS 1': 0,
                  '1. Units 1': 40,
                  'Product 1': ['recCCCCCCCCCCCCCC'],
                  'Vendor 1': ['recDDDDDDDDDDDDDD'],
                  SO: ['recEEEEEEEEEEEEEE'],
                },
              },
            ],
          };
    if (url === 'tblMqeGvgg4McO2hB')
      data = {
        records: [
          {
            id: 'recBBBBBBBBBBBBBB',
            fields: { Name: 'Fixture rep', Email: 'REP@example.test' },
          },
        ],
      };
    if (url === 'tblN8r5UQEIBkXjqj')
      data = {
        records: [
          { id: 'recCCCCCCCCCCCCCC', fields: { Name: 'Fixture ingredient' } },
        ],
      };
    if (url === 'tblBdoQM9R1D3XDhQ')
      data = {
        records: [
          {
            id: 'recDDDDDDDDDDDDDD',
            fields: { 'Vendor Name': 'Fixture vendor' },
          },
        ],
      };
    if (url === 'tblEbvMDHU0ThW0Yj')
      data = {
        records: [
          { id: 'recEEEEEEEEEEEEEE', fields: { 'GRD INVOICE': 'SO-1' } },
        ],
      };
    return { data, status: 200, statusText: 'OK', headers: {}, config };
  };
  const result = await new AirtableUpcomingSource('fixture-token').load(
    '2026-11-17',
    '2026-11-30',
  );
  expect(result.orders[0]).toMatchObject({
    salesOrders: ['SO-1'],
    reps: ['Fixture rep'],
    lines: [
      {
        lineNumber: 1,
        purchaseOrder: '0',
        pounds: 0,
        units: 40,
        product: 'Fixture ingredient',
        vendor: 'Fixture vendor',
      },
    ],
  });
  expect(calls[0]!.params.get('filterByFormula')).toContain(
    "{REQ SHIP} >= '2026-11-17'",
  );
  expect(calls[0]!.params.get('filterByFormula')).toContain('NOT({Test})');
  expect(calls[0]!.params.getAll('fields[]')).not.toContain('Actual Ship 1');
  expect(calls[0]!.params.getAll('fields[]')).not.toContain('Total Revenue');
  expect(calls[1]!.params.get('offset')).toBe('next-page');
});

it('resolves POs by linked product and vendor without borrowing a PO from another line or order', async () => {
  const id = (n: number) => `rec${String(n).padStart(14, '0')}`;
  const orderId = id(1);
  const lineTable = 'tblmLuTuX1RkziFOH';
  const lineLink = 'GRD SALES ORDERS - Line Items';
  const links = [10, 11, 12, 13, 14, 15, 16, 17, 18].map(id);
  const linked = (
    n: number,
    product: number,
    vendor: number,
    po: number | null,
    type = 'Product Price',
    parent = orderId,
  ) => ({
    id: id(n),
    fields: {
      Type: type,
      'GRD SALES ORDER': [parent],
      Product: [id(product)],
      Vendor: [id(vendor)],
      'GRD PO': po,
    },
  });
  const order = {
    id: orderId,
    fields: {
      'REQ SHIP': '2026-11-18',
      [lineLink]: links,
      'Product 1': [id(20)],
      'Vendor 1': [id(30)],
      'GRD PO 1': 999,
      'Product 2': [id(21)],
      'Product 3': [id(22)],
      'Vendor 3': [id(30)],
      'Product 4': [id(22)],
      'Vendor 4': [id(31)],
      'Product 5': [id(23)],
      'GRD PO 5': 777,
      'Product 6': [id(24)],
      'Product 7': [id(24)],
    },
  };
  const lineQueries: URLSearchParams[] = [];
  axios.defaults.adapter = async (config) => {
    let records: Array<{ id: string; fields: Record<string, unknown> }> = [];
    if (config.url === 'tbl7X5ROha1PzgGZt') records = [order];
    if (config.url === lineTable) {
      lineQueries.push(config.params as URLSearchParams);
      records = [
        linked(18, 24, 30, null),
        linked(17, 24, 30, 130),
        linked(16, 20, 30, 456, 'Product Price', id(2)),
        linked(15, 20, 30, 123, 'Shipping'),
        linked(14, 25, 30, 90002),
        linked(13, 22, 31, 505),
        linked(12, 22, 30, 404),
        linked(11, 21, 31, 0),
        linked(10, 20, 30, 90001),
      ];
    }
    if (config.url === 'tblN8r5UQEIBkXjqj')
      records = [20, 21, 22, 23, 24, 25].map((n) => ({
        id: id(n),
        fields: { Name: `Product ${n}` },
      }));
    if (config.url === 'tblBdoQM9R1D3XDhQ')
      records = [30, 31].map((n) => ({
        id: id(n),
        fields: { 'Vendor Name': `Vendor ${n}` },
      }));
    return {
      data: { records },
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    };
  };

  const result = await new AirtableUpcomingSource('fixture-token').load(
    '2026-11-18',
    '2026-11-30',
  );
  const actual = result.orders[0]!;
  expect(actual.lines.map((line) => line.purchaseOrder)).toEqual([
    '90001',
    '0',
    '404',
    '505',
    '777',
    null,
    null,
  ]);
  expect(actual).toMatchObject({
    additionalPurchaseOrders: expect.arrayContaining([
      {
        lineItemId: id(14),
        product: 'Product 25',
        vendor: 'Vendor 30',
        purchaseOrder: '90002',
      },
      {
        lineItemId: id(17),
        product: 'Product 24',
        vendor: 'Vendor 30',
        purchaseOrder: '130',
      },
    ]),
  });
  expect(actual).toHaveProperty('additionalPurchaseOrders.length', 2);
  expect(lineQueries).toHaveLength(1);
  expect(lineQueries[0]!.getAll('fields[]').sort()).toEqual(
    [
      'Type',
      'GRD SALES ORDER',
      'Product',
      'Vendor',
      'GRD PO',
      'SO',
      'Tracking#',
    ].sort(),
  );
});

it('reads only DOCS and validates attachment hosts', async () => {
  let url = 'https://v5.airtableusercontent.com/fixture';
  const calls: URLSearchParams[] = [];
  axios.defaults.adapter = async (config) => {
    calls.push(config.params as URLSearchParams);
    return {
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
      data: {
        records: [
          {
            id: 'recAAAAAAAAAAAAAA',
            fields: {
              'REQ SHIP': '2026-11-17',
              REP: [],
              DOCS: [
                {
                  id: 'attExample',
                  filename: 'bol.pdf',
                  size: 10,
                  type: 'application/pdf',
                  url,
                },
              ],
            },
          },
        ],
      },
    };
  };
  const source = new AirtableUpcomingSource('fixture');
  expect((await source.files('recAAAAAAAAAAAAAA'))?.files[0]?.filename).toBe(
    'bol.pdf',
  );
  expect(calls[0]?.getAll('fields[]')).toEqual([
    'REQ SHIP',
    'Test',
    'REP',
    'DOCS',
  ]);
  expect(calls[0]?.get('filterByFormula')).toBe(
    "RECORD_ID()='recAAAAAAAAAAAAAA'",
  );
  url = 'https://airtableusercontent.com.attacker.example/file';
  await expect(source.files('recAAAAAAAAAAAAAA')).rejects.toThrow();
});

it('merges distinct header and owned line references in order, including shipping rows', async () => {
  const id = (n: number) => `rec${String(n).padStart(14, '0')}`;
  const lineLink = 'GRD SALES ORDERS - Line Items';
  const header = (n: number, links: number[], fields = {}) => ({
    id: id(n),
    fields: { 'REQ SHIP': '2026-11-18', [lineLink]: links.map(id), ...fields },
  });
  const line = (n: number, parent: number, so: number, tracking: string) => ({
    id: id(n),
    fields: {
      Type: 'Shipping',
      'GRD SALES ORDER': [id(parent)],
      SO: [id(so)],
      'Tracking#': tracking,
    },
  });
  const tables: Record<string, unknown[]> = {
    tbl7X5ROha1PzgGZt: [
      header(1, [10, 11, 12], { SO: [id(20)], 'Tracking#': '001' }),
      header(2, [12]),
      header(3, []),
    ],
    tblmLuTuX1RkziFOH: [
      line(12, 2, 22, '003'),
      line(11, 1, 21, '002'),
      line(10, 1, 20, '001'),
    ],
    tblEbvMDHU0ThW0Yj: [20, 21, 22].map((n) => ({
      id: id(n),
      fields: { 'GRD INVOICE': `SO-${n}` },
    })),
  };
  axios.defaults.adapter = async (config) => ({
    data: { records: tables[config.url ?? ''] ?? [] },
    status: 200,
    statusText: 'OK',
    headers: {},
    config,
  });

  const { orders } = await new AirtableUpcomingSource('fixture').load(
    '2026-11-01',
    '2026-11-30',
  );
  expect(
    orders.map(({ salesOrders, tracking }) => ({ salesOrders, tracking })),
  ).toEqual([
    { salesOrders: ['SO-20', 'SO-21'], tracking: '001, 002' },
    { salesOrders: ['SO-22'], tracking: '003' },
    { salesOrders: [], tracking: null },
  ]);
});
