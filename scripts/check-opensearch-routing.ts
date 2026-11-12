import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

// No application/provider credentials, environment files or persistent captures.
// Simulates by default. --fixtures creates and removes isolated synthetic indexes.
const [clusterId, flag] = process.argv.slice(2);

assert(
  clusterId && (!flag || flag === '--fixtures'),
  'Usage: node scripts/check-opensearch-routing.ts CLUSTER_ID [--fixtures]',
);

const [cluster] = JSON.parse(
  execFileSync('doctl', ['databases', 'get', clusterId, '-o', 'json'], {
    encoding: 'utf8',
  }),
);

assert.equal(cluster.engine, 'opensearch');

const connection = cluster.connection;
const base = `https://${connection.host}:${connection.port}`;
const authorization = `Basic ${Buffer.from(`${connection.user}:${connection.password}`).toString('base64')}`;
const pipeline = JSON.parse(
  readFileSync(
    new URL('../.do/opensearch-debug-pipeline.json', import.meta.url),
    'utf8',
  ),
);
const components = ['api', 'worker', 'migrate'];

async function request(path: string, method = 'GET', body?: unknown) {
  const options: RequestInit = {
    method,
    headers: {
      Authorization: authorization,
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(30_000),
  };

  if (body !== undefined) {
    assert(!['GET', 'HEAD'].includes(method));
    options.body = JSON.stringify(body);
  }

  const response = await fetch(`${base}${path}`, options);

  // Do not include response bodies or connection details in error output.
  assert(response.ok, `OpenSearch returned HTTP ${response.status}`);

  return response.json();
}

function source(
  component: string,
  timestamp: string,
  log = 'synthetic routing check',
) {
  return { do_component_name: component, '@timestamp': timestamp, log };
}

const now = new Date();
const today = now.toISOString().slice(0, 10);
const midnight = new Date(`${today}T00:00:00Z`);
const oldest = new Date(midnight.getTime() - 7 * 86_400_000).toISOString();
const expired = new Date(midnight.getTime() - 7 * 86_400_000 - 1).toISOString();
const docs = components.flatMap((component) =>
  [1, 2].map((rollover) => ({
    _index: `grd-${component}-${rollover.toString().padStart(6, '0')}`,
    _id: `same-${component}`,
    _source: source(component, now.toISOString()),
  })),
);

docs.push(
  { _index: 'grd-ingress-api', _id: 'oldest', _source: source('api', oldest) },
  {
    _index: 'grd-ingress-api',
    _id: 'expired',
    _source: source('api', expired),
  },
  {
    _index: 'grd-ingress-api',
    _id: 'invalid',
    _source: source('api', 'invalid'),
  },
  {
    _index: 'grd-ingress-api',
    _id: 'structured',
    _source: source(
      'api',
      now.toISOString(),
      '{"event":"fixture.completed","level":"info"}',
    ),
  },
  {
    _index: 'grd-ingress-api',
    _id: 'scalar',
    _source: source('api', now.toISOString(), '42'),
  },
  {
    _index: 'grd-ingress-api',
    _id: 'offset',
    _source: source('api', `${today}T23:30:00-02:00`),
  },
);

const simulation = await request('/_ingest/pipeline/_simulate', 'POST', {
  pipeline,
  docs,
});

for (let i = 0; i < components.length; i++) {
  const first = simulation.docs[i * 2].doc;
  const replay = simulation.docs[i * 2 + 1].doc;

  assert.equal(first._index, replay._index);
  assert.equal(first._id, replay._id);
  assert(first._index.startsWith(`<grd-day-${components[i]}-{${today}`));
  assert.equal(first._source.log, 'synthetic routing check');
  assert(!('_grd_received_at' in first._source));
  assert(!('_grd_event_at' in first._source));
}

assert(simulation.docs[6].doc, 'Oldest retained UTC day must be accepted');
assert.equal(simulation.docs[7], null, 'Expired replay must be dropped');
assert.equal(simulation.docs[8].doc._index, 'grd-ingress-api');
assert.equal(simulation.docs[9].doc._source.grd.event, 'fixture.completed');
assert.equal(simulation.docs[10].doc._source.grd, undefined);
const nextDay = new Date(midnight.getTime() + 86_400_000)
  .toISOString()
  .slice(0, 10);
assert(
  simulation.docs[11].doc._index.includes(nextDay),
  'Offset must resolve to UTC day',
);

console.log(
  'PASS: three components, replay identity, retention boundary, plain/scalar/structured logs, malformed timestamp and UTC offset',
);

if (flag === '--fixtures') {
  const prefix = `routing-check-${randomUUID()}`;
  const scratchPipeline = structuredClone(pipeline);
  const indexes = new Set<string>();

  for (const processor of scratchPipeline.processors) {
    if (processor.date_index_name) {
      processor.date_index_name.index_name_prefix =
        processor.date_index_name.index_name_prefix.replace(
          'grd-day-',
          `${prefix}-day-`,
        );
    }
  }

  try {
    await request(`/_ingest/pipeline/${prefix}`, 'PUT', scratchPipeline);

    for (const component of components) {
      const target = `${prefix}-day-${component}-${today}`;
      indexes.add(target);
      await request(`/${target}`, 'PUT', {
        settings: {
          number_of_shards: 1,
          number_of_replicas: 0,
          'index.default_pipeline': prefix,
        },
      });

      for (const rollover of [1, 2]) {
        const ingress = `${prefix}-ingress-${component}-${rollover}`;
        indexes.add(ingress);
        await request(`/${ingress}`, 'PUT', {
          settings: {
            number_of_shards: 1,
            number_of_replicas: 0,
            'index.default_pipeline': prefix,
          },
        });
        await request(
          `/${ingress}/_doc/same?refresh=true`,
          'PUT',
          source(component, now.toISOString()),
        );
      }

      const count = await request(`/${target}/_count`);
      const document = await request(`/${target}/_doc/same`);

      assert.equal(
        count.count,
        1,
        'Replay across ingress indexes must store one record',
      );
      assert.equal(
        document._version,
        2,
        'Replay must update the original record',
      );
    }

    console.log(
      'PASS: real indexed retries overwrite one document for every component',
    );
  } finally {
    const failures: string[] = [];

    for (const index of indexes) {
      const exists = await fetch(`${base}/${index}`, {
        method: 'HEAD',
        headers: { Authorization: authorization },
        signal: AbortSignal.timeout(30_000),
      });

      if (exists.ok)
        await request(`/${index}`, 'DELETE').catch(() => failures.push(index));
      else if (exists.status !== 404) failures.push(index);
    }

    await request(`/_ingest/pipeline/${prefix}`, 'DELETE').catch(() =>
      failures.push('pipeline'),
    );
    assert.equal(
      failures.length,
      0,
      `Fixture cleanup incomplete: ${failures.join(', ')}`,
    );
    console.log('PASS: isolated fixture indexes and pipeline removed');
  }
}
