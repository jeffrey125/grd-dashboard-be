# GRD Dashboard

GRD employees manage Shipments and monitor their progress through Carriers.

## Language

### Shipment monitoring

**Shipment**:
A Carrier and Tracking Reference pair that employees monitor, with optional notes
and a monitoring state. Soft deletion removes it from the dashboard while retaining
its history; the same pair may then be added as a new Shipment.

**Carrier**:
A shipping provider whose tracking information GRD monitors. Disabling a Carrier
stops new lookups without deleting its Shipments.

**Tracking Reference**:
The Carrier's identifier for a Shipment, treated as text with case and leading
zeros preserved. Different Carriers may use the same reference.

**Tracking Snapshot**:
An immutable observation of known Carrier status, status detail, pickup,
estimated-delivery and delivered dates. Missing new information preserves known
values; unchanged observations reuse the current snapshot.

**Tracking Run**:
One scheduled or manually requested unit of tracking work for a Carrier.
A run contains one Tracking Attempt for each selected Shipment.

**Tracking Attempt**:
One logical lookup of a Shipment within a Tracking Run. Its outcome is found,
not found, failed or skipped; transport retries are not separate attempts.

**Manual Refresh**:
An employee's request to check one Shipment without waiting for its scheduled
check. Repeated requests while that refresh is pending refer to the same work.

**Monitoring State**:
Whether a Shipment is active, paused or completed. A pause can be manual or follow
consecutive confirmed not-found results; completed means delivery is known.

**Not-found Threshold**:
The number of consecutive confirmed absent results that automatically pauses a
Shipment. A technical lookup failure is not evidence of absence.

### Shipment order references

**GRD Purchase Order (PO)**:
A GRD purchase reference that may cover several tracked Shipments; a Shipment may carry several POs or have no PO.

**Sales Order (SO)**:
A sales reference associated with the goods in a Shipment. It is distinct from the GRD PO and may be shared across tracking references.

**Warehouse Stock**:
Goods shipped from warehouse inventory, identified in the sales export by GRD PO `0`. The associated SO identifies the sales order.

**Shipment Product**:
A product carried by a tracked Shipment. A Shipment may contain several products.

### Employee access

**Employee Account**:
An administrator-provisioned identity for a GRD employee. An account can be active
or deactivated; deactivation preserves attribution of the employee's past work.

**Admin**:
An employee authorized to manage Employee Accounts, Carrier configuration, and
diagnostic source data, as well as the normal Shipment workflow.

**Staff**:
An employee authorized to read Carriers and manage Shipments, including adding,
editing notes, pausing, resuming, requesting refreshes, and soft deletion.

**Issued Password**:
A temporary password assigned by an Admin when creating an Employee Account or
resetting its password. The employee must replace it before accessing business
features.

**Deactivation**:
Withdrawal of an Employee Account's access without deleting its history. An Admin
can reactivate the account later.
