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
