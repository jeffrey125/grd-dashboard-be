// Explicit current statuses already consumed by the carrier mappings. Do not
// infer a reversal from an unknown label, missing date, or free-text detail.
const undeliveredStatuses: Readonly<Record<string, readonly string[]>> = {
  ffe: ['scheduled', 'in route', 'out for delivery'],
  ups: [
    'in transit',
    'moving',
    'on the way',
    'loaded on delivery vehicle',
    'out for delivery',
  ],
  echoship: [
    'shipment enroute',
    'moving',
    'out for delivery',
    'checkedin',
    'pickedup',
    'picked up',
  ],
};

export function isExplicitlyUndelivered(
  carrierCode: string,
  carrierStatus: string | null,
): boolean {
  const status = carrierStatus?.replace(/\s+/g, ' ').trim().toLowerCase();

  return (
    !!status &&
    Object.hasOwn(undeliveredStatuses, carrierCode) &&
    undeliveredStatuses[carrierCode].includes(status)
  );
}
