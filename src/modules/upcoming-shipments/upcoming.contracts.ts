export interface AirtableRep {
  id: string;
  name: string;
  email: string | null;
}

export interface UpcomingOrder {
  id: string;
  requestedShipOn: string;
  salesOrders: string[];
  customer: string;
  customerPo: string | null;
  repIds: string[];
  reps: string[];
  tracking: string | null;
  notes: string | null;
  pallets: number | null;
  additionalPurchaseOrders?: Array<{
    lineItemId: string;
    product: string;
    vendor: string;
    purchaseOrder: string;
  }>;
  lines: Array<{
    lineNumber: number;
    product: string;
    vendor: string;
    purchaseOrder: string | null;
    pounds: number | null;
    units: number | null;
    origin: string | null;
  }>;
  airtableUrl: string;
}

export interface UpcomingSnapshot {
  orders: UpcomingOrder[];
  reps: AirtableRep[];
  updatedAt: string;
}

export interface UpcomingFile {
  id: string;
  filename: string;
  size: number;
  type: string;
  url: string;
}

export interface UpcomingFileRecord {
  requestedShipOn: string | null;
  test: boolean;
  repIds: string[];
  files: UpcomingFile[];
}

export interface UpcomingSource {
  readonly configured: boolean;
  load(from: string, through: string): Promise<UpcomingSnapshot>;
  reps(): Promise<AirtableRep[]>;
  files(orderId: string): Promise<UpcomingFileRecord | null>;
}

export const UPCOMING_SOURCE = Symbol('UPCOMING_SOURCE');

export interface UpcomingAccess {
  ownRepId: string | null;
  assignedRepIds: string[];
}

export interface UpcomingAccessRepository {
  account(externalId: string): Promise<{ id: number; email: string } | null>;
  get(accountId: number): Promise<UpcomingAccess>;
  replace(accountId: number, access: UpcomingAccess): Promise<void>;
}

export const UPCOMING_ACCESS = Symbol('UPCOMING_ACCESS');
