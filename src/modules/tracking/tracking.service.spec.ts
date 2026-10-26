import { describe, expect, it, vi } from 'vitest';
import { TrackingService } from './tracking.service.js';
import type {
  TrackingRepository,
  TrackingTransaction,
} from './tracking.repository.js';

function transaction(): TrackingTransaction {
  return {
    recordSessionOutcome: vi.fn(),
    lockAvailableCarrier: vi.fn(),
    lockTargetShipments: vi.fn(),
    insertRun: vi.fn(),
    insertAttempts: vi.fn(),
    lockRun: vi.fn(),
    markRunRunning: vi.fn(),
    loadRunTargets: vi.fn(),
    databaseNow: vi.fn(),
    lockAttempt: vi.fn(),
    loadCurrentSnapshot: vi.fn(),
    insertSnapshot: vi.fn(),
    updateShipmentFound: vi.fn(),
    updateShipmentNotFound: vi.fn(),
    updateShipmentFailed: vi.fn(),
    finalizeAttempt: vi.fn(),
    countAttempts: vi.fn(),
    updateRun: vi.fn(),
    finalizePendingAttempts: vi.fn(),
  };
}

function repository() {
  return { transaction: vi.fn() } satisfies TrackingRepository;
}

describe('TrackingService', () => {
  it('rejects duplicate Shipment targets before repository access', () => {
    const persistence = repository();
    const service = new TrackingService(persistence);
    const id = '3ec26390-9b86-4f9c-a243-d9d147a724ae';

    expect(() =>
      service.createRun({
        carrierExternalId: '01bb5645-c7c9-4d5b-975b-e27cd56a46cb',
        trigger: 'scheduled',
        shipmentExternalIds: [id, id],
        requestedById: null,
      }),
    ).toThrow('Shipment IDs must be unique');
    expect(persistence.transaction).not.toHaveBeenCalled();
  });

  it('rejects invalid normalized dates before repository access', () => {
    const persistence = repository();
    const service = new TrackingService(persistence);

    expect(() =>
      service.finalizeFound({
        runExternalId: '68b7d0a1-ab9d-4e0d-8334-7e0a4b3f5e64',
        shipmentExternalId: 'ba410f40-aa92-4f9e-be18-8827093bd359',
        expectedLockVersion: 1,
        effectiveIntervalMinutes: 5,
        snapshot: {
          carrierStatus: 'Moving',
          carrierStatusDetail: null,
          pickedUpOn: null,
          estimatedDeliveryOn: '2026-02-30',
          deliveredOn: null,
        },
        sourceData: null,
      }),
    ).toThrow('Invalid calendar date');
    expect(persistence.transaction).not.toHaveBeenCalled();
  });

  it('passes sanitized source data through without reshaping it', async () => {
    const persistence = repository();
    const tx = transaction();

    vi.mocked(persistence.transaction).mockImplementation((work) => work(tx));
    vi.mocked(tx.lockAttempt).mockResolvedValue({
      runId: 'run-id',
      runTrigger: 'scheduled',
      runStatus: 'running',
      attemptId: 'attempt-id',
      attemptOutcome: 'pending',
      shipmentId: 1,
      shipmentExternalId: 'ba410f40-aa92-4f9e-be18-8827093bd359',
      trackingReference: 'SAFE',
      verificationUrl: null,
      currentTrackingSnapshotId: null,
      monitoringStatus: 'active',
      monitoringReason: null,
      consecutiveNotFoundCount: 0,
      consecutiveFailureCount: 0,
      failurePauseEnabled: true,
      failurePauseThreshold: 2,
      lockVersion: 1,
      deletedAt: null,
      carrierCode: 'ups',
      notFoundPauseThreshold: 5,
    });
    vi.mocked(tx.databaseNow).mockResolvedValue(new Date());
    vi.mocked(tx.updateShipmentFailed).mockResolvedValue(true);

    const service = new TrackingService(persistence);
    const sourceData = { carrierCode: 'SAFE', nested: { value: 42 } };

    await service.finalizeFailed({
      runExternalId: '68b7d0a1-ab9d-4e0d-8334-7e0a4b3f5e64',
      shipmentExternalId: 'ba410f40-aa92-4f9e-be18-8827093bd359',
      expectedLockVersion: 1,
      effectiveIntervalMinutes: 5,
      retryable: true,
      reasonCode: 'TIMEOUT',
      message: null,
      sourceData,
    });

    expect(tx.finalizeAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ sourceData }),
    );
  });

  it('rejects invalid run IDs before repository access', () => {
    const persistence = repository();
    const service = new TrackingService(persistence);

    expect(() => service.startRun('not-a-uuid')).toThrow();
    expect(() => service.finalizeRun('not-a-uuid')).toThrow();
    expect(() => service.cancelRun('not-a-uuid')).toThrow();
    expect(persistence.transaction).not.toHaveBeenCalled();
  });
});
