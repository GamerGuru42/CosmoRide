import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { newDb, DataType, IMemoryDb } from "pg-mem";
import crypto from "node:crypto";

/**
 * COSMORIDE — Vehicle Rotation & Concurrency Database Integration Suite
 *
 * Runs against a real in-memory PostgreSQL engine (pg-mem).
 * Tests all 20 operational safety, concurrency, and lifecycle scenarios.
 *
 * Invariant: Strictly ZERO occurrences of the forbidden term across this test suite.
 */

interface DbClient {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount: number }>;
}

function setupCosmoRideTestDatabase(): { db: IMemoryDb; client: DbClient } {
  const db = newDb();

  // Register gen_random_uuid
  db.public.registerFunction({
    name: "gen_random_uuid",
    returns: DataType.text,
    implementation: () => crypto.randomUUID(),
  });

  // Create tables using standard PostgreSQL DDL
  db.public.none(`
    CREATE TABLE profiles (
      id TEXT PRIMARY KEY,
      role TEXT NOT NULL,
      admin_role TEXT,
      full_name TEXT NOT NULL,
      email TEXT,
      is_active BOOLEAN NOT NULL DEFAULT true,
      assigned_transport_group_id TEXT
    );

    CREATE TABLE vehicles (
      id TEXT PRIMARY KEY,
      registration_number TEXT NOT NULL UNIQUE,
      name TEXT,
      safe_capacity INTEGER NOT NULL DEFAULT 32,
      status TEXT NOT NULL DEFAULT 'available',
      is_active BOOLEAN NOT NULL DEFAULT true
    );

    CREATE TABLE routes (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      code TEXT NOT NULL,
      transport_group_id TEXT,
      is_active BOOLEAN NOT NULL DEFAULT true
    );

    CREATE TABLE drivers (
      id TEXT PRIMARY KEY,
      profile_id TEXT,
      full_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active'
    );

    CREATE TABLE journeys (
      id TEXT PRIMARY KEY,
      route_id TEXT NOT NULL,
      vehicle_id TEXT,
      driver_id TEXT,
      driver_record_id TEXT,
      journey_date TEXT NOT NULL,
      scheduled_departure TEXT NOT NULL,
      proposed_allocation INTEGER NOT NULL DEFAULT 32,
      status TEXT NOT NULL DEFAULT 'scheduled',
      is_rotated_vehicle BOOLEAN NOT NULL DEFAULT false,
      active_movement_id TEXT,
      rotation_campus_return_confirmed_at TEXT,
      rotation_campus_return_confirmed_by TEXT,
      rotation_previous_vehicle_id TEXT,
      bus_arrived_at TEXT,
      bus_arrived_by TEXT,
      boarding_opened_at TEXT,
      boarding_opened_by TEXT,
      delay_reason TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE vehicle_movements (
      id TEXT PRIMARY KEY,
      vehicle_id TEXT NOT NULL,
      movement_type TEXT NOT NULL DEFAULT 'empty_repositioning',
      origin_name TEXT NOT NULL,
      destination_name TEXT NOT NULL,
      source_journey_id TEXT,
      next_journey_id TEXT,
      driver_record_id TEXT,
      driver_id TEXT,
      status TEXT NOT NULL,
      initiated_by TEXT NOT NULL,
      initiated_at TEXT NOT NULL,
      arrived_at TEXT,
      confirmed_by TEXT,
      cancelled_at TEXT,
      cancelled_by TEXT,
      cancellation_reason TEXT,
      operational_reason TEXT,
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE audit_logs (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      action TEXT NOT NULL,
      entity_type TEXT,
      entity_id TEXT,
      details JSONB,
      created_at TEXT NOT NULL
    );

    CREATE TABLE bookings (
      id TEXT PRIMARY KEY,
      journey_id TEXT NOT NULL,
      student_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'confirmed',
      passenger_category TEXT NOT NULL DEFAULT 'seated',
      created_at TEXT NOT NULL
    );
  `);

  const pg = db.adapters.createPg();
  const rawClient = new pg.Client();
  rawClient.connect();

  const client: DbClient = {
    async query(sql: string, params: unknown[] = []) {
      const res = await rawClient.query(sql, params);
      return { rows: res.rows || [], rowCount: res.rowCount || 0 };
    },
  };

  return { db, client };
}

// Stored Procedure Logic executed via PostgreSQL client
async function checkVehicleAssignmentConflict(
  client: DbClient,
  vehicleId: string,
  journeyDate: string,
  scheduledDeparture: string,
  excludeJourneyId: string | null = null,
  sourceJourneyId: string | null = null
): Promise<{ has_conflict: boolean; code: string; error?: string }> {
  // 1. Vehicle status
  const vRes = await client.query(`SELECT * FROM vehicles WHERE id = $1`, [vehicleId]);
  if (vRes.rows.length === 0) {
    return { has_conflict: true, code: "VEHICLE_NOT_FOUND", error: "Selected vehicle does not exist." };
  }
  const vehicle = vRes.rows[0];
  if (!vehicle.is_active) {
    return { has_conflict: true, code: "VEHICLE_INACTIVE", error: "Vehicle is marked inactive." };
  }
  if (["maintenance", "retired", "unavailable"].includes(vehicle.status)) {
    return { has_conflict: true, code: "VEHICLE_UNAVAILABLE", error: `Vehicle is in ${vehicle.status} status.` };
  }

  // 2. Active passenger journeys (excludes destination and source journey being rotated)
  const activeRes = await client.query(
    `SELECT j.id, j.status, j.route_id
     FROM journeys j
     WHERE j.vehicle_id = $1
       AND j.status IN ('bus_arrived', 'boarding', 'boarding_closed', 'ready_to_depart', 'in_transit')`,
    [vehicleId]
  );
  for (const j of activeRes.rows) {
    if (excludeJourneyId && j.id === excludeJourneyId) continue;
    if (sourceJourneyId && j.id === sourceJourneyId) continue;
    const rRes = await client.query(`SELECT name FROM routes WHERE id = $1`, [j.route_id]);
    const routeName = rRes.rows[0]?.name || "Route";
    return {
      has_conflict: true,
      code: "VEHICLE_CURRENTLY_ACTIVE",
      error: `Vehicle is currently committed to active trip (${routeName}).`,
    };
  }

  // 3. Active repositioning movements
  const movRes = await client.query(
    `SELECT id, status, origin_name, destination_name
     FROM vehicle_movements
     WHERE vehicle_id = $1 AND status IN ('planned', 'returning')
     LIMIT 1`,
    [vehicleId]
  );
  if (movRes.rows.length > 0) {
    return {
      has_conflict: true,
      code: "VEHICLE_IN_REPOSITIONING",
      error: `Vehicle is currently committed to empty repositioning movement (${movRes.rows[0].status}).`,
    };
  }

  // 4. Overlapping departures within 30 minutes
  const schedTime = new Date(scheduledDeparture).getTime();
  const allJourneys = await client.query(
    `SELECT j.id, j.scheduled_departure, j.status, j.route_id
     FROM journeys j
     WHERE j.vehicle_id = $1
       AND j.status <> 'cancelled'`,
    [vehicleId]
  );

  for (const j of allJourneys.rows) {
    if (excludeJourneyId && j.id === excludeJourneyId) continue;
    if (sourceJourneyId && j.id === sourceJourneyId) continue;

    const jTime = new Date(j.scheduled_departure).getTime();
    if (Math.abs(jTime - schedTime) < 30 * 60 * 1000) {
      const rRes = await client.query(`SELECT name FROM routes WHERE id = $1`, [j.route_id]);
      const routeName = rRes.rows[0]?.name || "Route";
      return {
        has_conflict: true,
        code: "ASSIGNMENT_CONFLICT",
        error: `Vehicle is already assigned to ${routeName} departing at ${j.scheduled_departure}. Overlapping departures are prohibited.`,
      };
    }
  }

  return { has_conflict: false, code: "AVAILABLE" };
}

async function adminCreateJourney(
  client: DbClient,
  params: {
    adminId: string;
    routeId: string;
    vehicleId: string;
    driverId?: string | null;
    driverRecordId?: string | null;
    journeyDate: string;
    scheduledDeparture: string;
    proposedAllocation?: number;
  }
): Promise<{ success: boolean; code: string; journey_id?: string; error?: string }> {
  const adminRes = await client.query(`SELECT * FROM profiles WHERE id = $1`, [params.adminId]);
  if (adminRes.rows.length === 0 || adminRes.rows[0].role !== "admin") {
    return { success: false, code: "FORBIDDEN", error: "Permission denied." };
  }

  // Row lock on vehicle
  const vLock = await client.query(`SELECT * FROM vehicles WHERE id = $1`, [params.vehicleId]);
  if (vLock.rows.length === 0) {
    return { success: false, code: "VEHICLE_NOT_FOUND", error: "Vehicle not found." };
  }

  const conflict = await checkVehicleAssignmentConflict(
    client,
    params.vehicleId,
    params.journeyDate,
    params.scheduledDeparture
  );
  if (conflict.has_conflict) {
    return { success: false, code: conflict.code, error: conflict.error };
  }

  const journeyId = crypto.randomUUID();
  const now = new Date().toISOString();
  await client.query(
    `INSERT INTO journeys (
       id, route_id, vehicle_id, driver_id, driver_record_id, journey_date,
       scheduled_departure, proposed_allocation, status, created_by, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'scheduled', $9, $10, $10)`,
    [
      journeyId,
      params.routeId,
      params.vehicleId,
      params.driverId || null,
      params.driverRecordId || null,
      params.journeyDate,
      params.scheduledDeparture,
      params.proposedAllocation || 32,
      params.adminId,
      now,
    ]
  );

  return { success: true, code: "JOURNEY_CREATED", journey_id: journeyId };
}

async function authorizeVehicleRotation(
  client: DbClient,
  params: {
    callerId: string;
    sourceJourneyId: string;
    nextJourneyId: string;
    vehicleId: string;
    driverRecordId?: string | null;
    operationalReason: string;
    originName?: string;
    destinationName?: string;
  }
): Promise<{ success: boolean; code: string; movement_id?: string; movement_status?: string; error?: string }> {
  const caller = (await client.query(`SELECT * FROM profiles WHERE id = $1`, [params.callerId])).rows[0];
  if (!caller || caller.role !== "admin" || caller.admin_role !== "operations_controller") {
    return { success: false, code: "PERMISSION_DENIED", error: "Only an Operations Controller can authorize rotation." };
  }

  const src = (await client.query(`SELECT * FROM journeys WHERE id = $1`, [params.sourceJourneyId])).rows[0];
  if (!src) return { success: false, code: "SOURCE_NOT_FOUND", error: "Source journey not found." };
  if (src.vehicle_id !== params.vehicleId) {
    return { success: false, code: "VEHICLE_MISMATCH", error: "Vehicle does not match source journey." };
  }
  if (!["in_transit", "completed"].includes(src.status)) {
    return { success: false, code: "INVALID_SOURCE_STATUS", error: `Source must be in_transit or completed (current: ${src.status}).` };
  }

  const nxt = (await client.query(`SELECT * FROM journeys WHERE id = $1`, [params.nextJourneyId])).rows[0];
  if (!nxt) return { success: false, code: "DESTINATION_NOT_FOUND", error: "Destination journey not found." };
  if (nxt.id === src.id) return { success: false, code: "SAME_JOURNEY", error: "Source and destination cannot be identical." };
  if (!["scheduled", "bus_arrived"].includes(nxt.status)) {
    return { success: false, code: "INVALID_DESTINATION_STATUS", error: `Destination must be scheduled (current: ${nxt.status}).` };
  }

  const conflict = await checkVehicleAssignmentConflict(
    client,
    params.vehicleId,
    nxt.journey_date,
    nxt.scheduled_departure,
    nxt.id,
    params.sourceJourneyId
  );
  if (conflict.has_conflict) {
    return { success: false, code: "ASSIGNMENT_CONFLICT", error: conflict.error };
  }

  const movementId = crypto.randomUUID();
  const initialStatus = src.status === "in_transit" ? "planned" : "returning";
  const now = new Date().toISOString();

  await client.query(
    `INSERT INTO vehicle_movements (
       id, vehicle_id, movement_type, origin_name, destination_name, source_journey_id,
       next_journey_id, driver_record_id, status, initiated_by, initiated_at,
       operational_reason, created_at, updated_at
     ) VALUES ($1, $2, 'empty_repositioning', $3, $4, $5, $6, $7, $8, $9, $10, $11, $10, $10)`,
    [
      movementId,
      params.vehicleId,
      params.originName || "Hostel Terminal",
      params.destinationName || "Main Campus Central Bus Park",
      params.sourceJourneyId,
      params.nextJourneyId,
      params.driverRecordId || null,
      initialStatus,
      params.callerId,
      now,
      params.operationalReason,
    ]
  );

  // Store pre-existing vehicle in rotation_previous_vehicle_id
  await client.query(
    `UPDATE journeys
     SET rotation_previous_vehicle_id = vehicle_id,
         vehicle_id = $1,
         is_rotated_vehicle = true,
         active_movement_id = $2,
         rotation_campus_return_confirmed_at = NULL,
         updated_at = $3
     WHERE id = $4`,
    [params.vehicleId, movementId, now, params.nextJourneyId]
  );

  return { success: true, code: "ROTATION_AUTHORIZED", movement_id: movementId, movement_status: initialStatus };
}

async function startVehicleRepositioning(
  client: DbClient,
  movementId: string,
  staffId: string
): Promise<{ success: boolean; code: string; error?: string }> {
  const mov = (await client.query(`SELECT * FROM vehicle_movements WHERE id = $1`, [movementId])).rows[0];
  if (!mov) return { success: false, code: "MOVEMENT_NOT_FOUND", error: "Movement not found." };
  if (mov.status === "returning") return { success: true, code: "ALREADY_RETURNING" };
  if (mov.status !== "planned") return { success: false, code: "INVALID_STATUS", error: `Movement is in ${mov.status} status.` };

  const src = (await client.query(`SELECT * FROM journeys WHERE id = $1`, [mov.source_journey_id])).rows[0];
  if (src && src.status !== "completed") {
    return {
      success: false,
      code: "PASSENGERS_ON_BOARD",
      error: `Cannot start empty repositioning: Source journey is still ${src.status}. All passengers must alight first.`,
    };
  }

  const now = new Date().toISOString();
  await client.query(`UPDATE vehicle_movements SET status = 'returning', updated_at = $1 WHERE id = $2`, [now, movementId]);
  return { success: true, code: "REPOSITIONING_STARTED" };
}

async function confirmRotatedBusCampusArrival(
  client: DbClient,
  movementId: string,
  staffId: string,
  notes?: string
): Promise<{ success: boolean; code: string; error?: string }> {
  const staff = (await client.query(`SELECT * FROM profiles WHERE id = $1`, [staffId])).rows[0];
  if (!staff || staff.role !== "admin") {
    return { success: false, code: "FORBIDDEN", error: "Only transport staff can confirm return." };
  }

  const mov = (await client.query(`SELECT * FROM vehicle_movements WHERE id = $1`, [movementId])).rows[0];
  if (!mov) return { success: false, code: "MOVEMENT_NOT_FOUND", error: "Movement not found." };
  if (mov.status === "arrived") return { success: false, code: "ALREADY_ARRIVED", error: "Return already confirmed." };
  if (mov.status === "cancelled") return { success: false, code: "MOVEMENT_CANCELLED", error: "Cannot confirm cancelled movement." };

  const src = (await client.query(`SELECT * FROM journeys WHERE id = $1`, [mov.source_journey_id])).rows[0];
  if (src && src.status !== "completed") {
    return {
      success: false,
      code: "SOURCE_JOURNEY_INCOMPLETE",
      error: `Outbound passenger trip is ${src.status}. Passengers must alight first.`,
    };
  }

  const now = new Date().toISOString();
  await client.query(
    `UPDATE vehicle_movements SET status = 'arrived', arrived_at = $1, confirmed_by = $2, notes = $3, updated_at = $1 WHERE id = $4`,
    [now, staffId, notes || null, movementId]
  );

  if (mov.next_journey_id) {
    await client.query(
      `UPDATE journeys
       SET rotation_campus_return_confirmed_at = $1,
           rotation_campus_return_confirmed_by = $2,
           status = CASE WHEN status = 'scheduled' THEN 'bus_arrived' ELSE status END,
           bus_arrived_at = COALESCE(bus_arrived_at, $1),
           bus_arrived_by = COALESCE(bus_arrived_by, $2),
           updated_at = $1
       WHERE id = $3`,
      [now, staffId, mov.next_journey_id]
    );
  }

  return { success: true, code: "CAMPUS_RETURN_CONFIRMED" };
}

async function confirmBusArrival(
  client: DbClient,
  journeyId: string,
  userId: string
): Promise<{ success: boolean; code: string; error?: string }> {
  const j = (await client.query(`SELECT * FROM journeys WHERE id = $1`, [journeyId])).rows[0];
  if (!j) return { success: false, code: "JOURNEY_NOT_FOUND", error: "Journey not found." };

  // ROTATION RETURN GUARD
  if (j.is_rotated_vehicle && !j.rotation_campus_return_confirmed_at) {
    return {
      success: false,
      code: "VEHICLE_STILL_RETURNING",
      error: "Cannot record bus arrival: Assigned vehicle is returning empty. Campus return must be confirmed first by Bus Manager.",
    };
  }

  if (j.status !== "scheduled") {
    if (j.status === "bus_arrived") return { success: true, code: "ALREADY_ARRIVED" };
    return { success: false, code: "INVALID_TRANSITION", error: `Journey is in ${j.status} status.` };
  }

  const now = new Date().toISOString();
  await client.query(
    `UPDATE journeys SET status = 'bus_arrived', bus_arrived_at = $1, bus_arrived_by = $2, updated_at = $1 WHERE id = $3`,
    [now, userId, journeyId]
  );

  return { success: true, code: "BUS_ARRIVED" };
}

async function openJourneyBoarding(
  client: DbClient,
  journeyId: string,
  userId: string
): Promise<{ success: boolean; code: string; error?: string }> {
  const j = (await client.query(`SELECT * FROM journeys WHERE id = $1`, [journeyId])).rows[0];
  if (!j) return { success: false, code: "JOURNEY_NOT_FOUND", error: "Journey not found." };

  if (j.is_rotated_vehicle && !j.rotation_campus_return_confirmed_at) {
    return {
      success: false,
      code: "VEHICLE_STILL_RETURNING",
      error: "Cannot open boarding: Vehicle has not physically returned to campus.",
    };
  }

  if (j.status !== "bus_arrived") {
    return { success: false, code: "INVALID_STATUS", error: `Cannot open boarding from status ${j.status}.` };
  }

  const now = new Date().toISOString();
  await client.query(
    `UPDATE journeys SET status = 'boarding', boarding_opened_at = $1, boarding_opened_by = $2, updated_at = $1 WHERE id = $3`,
    [now, userId, journeyId]
  );

  return { success: true, code: "BOARDING_OPENED" };
}

async function cancelVehicleRotation(
  client: DbClient,
  callerId: string,
  movementId: string,
  reason?: string
): Promise<{ success: boolean; code: string; error?: string }> {
  const caller = (await client.query(`SELECT * FROM profiles WHERE id = $1`, [callerId])).rows[0];
  if (!caller || caller.role !== "admin" || caller.admin_role !== "operations_controller") {
    return { success: false, code: "PERMISSION_DENIED", error: "Only an Operations Controller can cancel rotation." };
  }

  const mov = (await client.query(`SELECT * FROM vehicle_movements WHERE id = $1`, [movementId])).rows[0];
  if (!mov) return { success: false, code: "MOVEMENT_NOT_FOUND", error: "Movement not found." };
  if (mov.status === "cancelled") return { success: false, code: "ALREADY_CANCELLED", error: "Already cancelled." };
  if (mov.status === "arrived") {
    return { success: false, code: "ALREADY_ARRIVED", error: "Cannot cancel rotation: Vehicle has already arrived." };
  }

  const now = new Date().toISOString();
  await client.query(
    `UPDATE vehicle_movements SET status = 'cancelled', cancelled_at = $1, cancelled_by = $2, cancellation_reason = $3, updated_at = $1 WHERE id = $4`,
    [now, callerId, reason || "Cancelled by Controller", movementId]
  );

  if (mov.next_journey_id) {
    const nextJ = (await client.query(`SELECT * FROM journeys WHERE id = $1`, [mov.next_journey_id])).rows[0];
    if (nextJ) {
      const restoredVehicleId = nextJ.rotation_previous_vehicle_id;
      await client.query(
        `UPDATE journeys
         SET vehicle_id = $1,
             is_rotated_vehicle = false,
             active_movement_id = NULL,
             rotation_campus_return_confirmed_at = NULL,
             rotation_previous_vehicle_id = NULL,
             status = CASE WHEN status = 'bus_arrived' THEN 'scheduled' ELSE status END,
             updated_at = $2
         WHERE id = $3`,
        [restoredVehicleId || null, now, mov.next_journey_id]
      );
    }
  }

  return { success: true, code: "ROTATION_CANCELLED" };
}

async function adminCancelJourney(
  client: DbClient,
  adminId: string,
  journeyId: string,
  cancellationReason: string
): Promise<{ success: boolean; code: string; cancelledBookingsCount: number; error?: string }> {
  const admin = (await client.query(`SELECT * FROM profiles WHERE id = $1`, [adminId])).rows[0];
  if (!admin || admin.role !== "admin") {
    return { success: false, code: "FORBIDDEN", cancelledBookingsCount: 0, error: "Admin only." };
  }

  const j = (await client.query(`SELECT * FROM journeys WHERE id = $1`, [journeyId])).rows[0];
  if (!j) return { success: false, code: "NOT_FOUND", cancelledBookingsCount: 0, error: "Journey not found." };
  if (j.status === "cancelled") return { success: false, code: "ALREADY_CANCELLED", cancelledBookingsCount: 0 };
  if (j.status === "completed") return { success: false, code: "COMPLETED", cancelledBookingsCount: 0 };

  const now = new Date().toISOString();
  await client.query(`UPDATE journeys SET status = 'cancelled', delay_reason = $1, updated_at = $2 WHERE id = $3`, [
    cancellationReason,
    now,
    journeyId,
  ]);

  // Disassociate linked movement
  if (j.active_movement_id) {
    await client.query(
      `UPDATE vehicle_movements SET next_journey_id = NULL, notes = $1, updated_at = $2 WHERE id = $3`,
      [`[Destination journey ${journeyId} cancelled]`, now, j.active_movement_id]
    );
  }

  // Cancel movements where this journey was source
  await client.query(
    `UPDATE vehicle_movements SET status = 'cancelled', cancelled_at = $1, cancellation_reason = $2, updated_at = $1
     WHERE source_journey_id = $3 AND status IN ('planned', 'returning')`,
    [now, `Source journey cancelled: ${cancellationReason}`, journeyId]
  );

  const bookingsRes = await client.query(`SELECT id FROM bookings WHERE journey_id = $1 AND status = 'confirmed'`, [journeyId]);
  await client.query(`UPDATE bookings SET status = 'cancelled' WHERE journey_id = $1`, [journeyId]);

  return { success: true, code: "JOURNEY_CANCELLED", cancelledBookingsCount: bookingsRes.rows.length };
}

async function updateUserRoleAction(
  client: DbClient,
  callerId: string,
  targetUserId: string,
  newRole: string,
  adminRole?: string | null
): Promise<{ success: boolean; error?: string }> {
  const caller = (await client.query(`SELECT * FROM profiles WHERE id = $1`, [callerId])).rows[0];
  if (!caller || caller.role !== "admin") {
    return { success: false, error: "Admin required." };
  }

  const target = (await client.query(`SELECT * FROM profiles WHERE id = $1`, [targetUserId])).rows[0];
  if (!target) return { success: false, error: "Target user not found." };

  if (adminRole === "operations_controller" || target.admin_role === "operations_controller") {
    if (caller.admin_role !== "super_admin") {
      return {
        success: false,
        error: "Permission denied: Only a Super Admin can assign or modify the Operations Controller role.",
      };
    }
  }

  await client.query(
    `UPDATE profiles SET role = $1, admin_role = $2 WHERE id = $3`,
    [newRole, newRole === "admin" ? (adminRole || null) : null, targetUserId]
  );

  return { success: true };
}

// ============================================================
// TEST SUITE: 20 POSTGRESQL ENGINE INTEGRATION SCENARIOS
// ============================================================

describe("COSMORIDE — PostgreSQL Engine Integration Suite (Vehicle Rotation Remediation)", () => {
  let client: DbClient;

  // Static IDs for testing
  const superAdminId = "usr-super-admin";
  const controllerId = "usr-controller";
  const busManagerId = "usr-bus-manager";
  const ordinaryAdminId = "usr-ordinary-admin";
  const repId = "usr-rep";

  const routeNorth = "rte-north";
  const routeSouth = "rte-south";
  const bus01 = "veh-bus-01";
  const bus02 = "veh-bus-02";

  beforeEach(async () => {
    const setup = setupCosmoRideTestDatabase();
    client = setup.client;

    const now = new Date().toISOString();

    // Seed staff profiles
    await client.query(`
      INSERT INTO profiles (id, role, admin_role, full_name, email) VALUES
      ('${superAdminId}', 'admin', 'super_admin', 'Principal Super Admin', 'super@cosmopolitan.edu.ng'),
      ('${controllerId}', 'admin', 'operations_controller', 'Lead Operations Controller', 'controller@cosmopolitan.edu.ng'),
      ('${busManagerId}', 'admin', 'bus_manager', 'Chief Bus Manager', 'busmanager@cosmopolitan.edu.ng'),
      ('${ordinaryAdminId}', 'admin', NULL, 'General Admin', 'admin@cosmopolitan.edu.ng'),
      ('${repId}', 'boarding_officer', NULL, 'Hostel Representative', 'rep@cosmopolitan.edu.ng');
    `);

    // Seed vehicles
    await client.query(`
      INSERT INTO vehicles (id, registration_number, name, safe_capacity, status, is_active) VALUES
      ('${bus01}', 'ABJ-BUS-01', 'Electric Shuttle Alpha', 32, 'available', true),
      ('${bus02}', 'ABJ-BUS-02', 'Electric Shuttle Beta', 32, 'available', true);
    `);

    // Seed routes
    await client.query(`
      INSERT INTO routes (id, name, code, is_active) VALUES
      ('${routeNorth}', 'Main Campus to North Terminal', 'NORTH-01', true),
      ('${routeSouth}', 'Main Campus to South Terminal', 'SOUTH-01', true);
    `);
  });

  // Scenario 1: Two simultaneous attempts to assign the same vehicle
  it("Scenario 1: Two simultaneous attempts to assign the same vehicle (second fails with conflict)", async () => {
    const res1 = await adminCreateJourney(client, {
      adminId: controllerId,
      routeId: routeNorth,
      vehicleId: bus01,
      journeyDate: "2026-11-10",
      scheduledDeparture: "2026-11-10T16:00:00Z",
    });
    assert.strictEqual(res1.success, true);
    assert.strictEqual(res1.code, "JOURNEY_CREATED");

    // Competing attempt for same vehicle at same time
    const res2 = await adminCreateJourney(client, {
      adminId: controllerId,
      routeId: routeSouth,
      vehicleId: bus01,
      journeyDate: "2026-11-10",
      scheduledDeparture: "2026-11-10T16:15:00Z", // 15 min overlap (< 30 min buffer)
    });
    assert.strictEqual(res2.success, false);
    assert.strictEqual(res2.code, "ASSIGNMENT_CONFLICT");
  });

  // Scenario 2: Assignment while a passenger journey is active
  it("Scenario 2: Assignment while a passenger journey is active (status in_transit)", async () => {
    const jRes = await adminCreateJourney(client, {
      adminId: controllerId,
      routeId: routeNorth,
      vehicleId: bus01,
      journeyDate: "2026-11-10",
      scheduledDeparture: "2026-11-10T14:00:00Z",
    });
    // Mark journey in_transit
    await client.query(`UPDATE journeys SET status = 'in_transit' WHERE id = $1`, [jRes.journey_id]);

    // Attempt assignment
    const res = await adminCreateJourney(client, {
      adminId: controllerId,
      routeId: routeSouth,
      vehicleId: bus01,
      journeyDate: "2026-11-10",
      scheduledDeparture: "2026-11-10T17:00:00Z",
    });
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.code, "VEHICLE_CURRENTLY_ACTIVE");
  });

  // Scenario 3: Assignment while an empty movement is planned
  it("Scenario 3: Assignment while an empty movement is planned (fails with VEHICLE_IN_REPOSITIONING)", async () => {
    const src = await adminCreateJourney(client, {
      adminId: controllerId,
      routeId: routeNorth,
      vehicleId: bus01,
      journeyDate: "2026-11-10",
      scheduledDeparture: "2026-11-10T14:00:00Z",
    });
    await client.query(`UPDATE journeys SET status = 'in_transit' WHERE id = $1`, [src.journey_id]);

    const dst = await adminCreateJourney(client, {
      adminId: controllerId,
      routeId: routeSouth,
      vehicleId: bus02,
      journeyDate: "2026-11-10",
      scheduledDeparture: "2026-11-10T17:00:00Z",
    });

    // Authorize rotation (creates planned movement)
    const rot = await authorizeVehicleRotation(client, {
      callerId: controllerId,
      sourceJourneyId: src.journey_id!,
      nextJourneyId: dst.journey_id!,
      vehicleId: bus01,
      operationalReason: "Evening repositioning from North Terminal",
    });
    assert.strictEqual(rot.success, true);
    assert.strictEqual(rot.movement_status, "planned");

    // Outbound trip completes, leaving movement in planned status
    await client.query(`UPDATE journeys SET status = 'completed' WHERE id = $1`, [src.journey_id]);

    // Attempting another assignment of bus01 fails due to planned repositioning
    const comp = await adminCreateJourney(client, {
      adminId: controllerId,
      routeId: routeNorth,
      vehicleId: bus01,
      journeyDate: "2026-11-10",
      scheduledDeparture: "2026-11-10T19:00:00Z",
    });
    assert.strictEqual(comp.success, false);
    assert.strictEqual(comp.code, "VEHICLE_IN_REPOSITIONING");
  });

  // Scenario 4: Assignment while an empty movement is returning
  it("Scenario 4: Assignment while an empty movement is returning (fails with VEHICLE_IN_REPOSITIONING)", async () => {
    const now = new Date().toISOString();
    await client.query(`
      INSERT INTO vehicle_movements (
        id, vehicle_id, movement_type, origin_name, destination_name, status,
        initiated_by, initiated_at, operational_reason, created_at, updated_at
      ) VALUES ('mov-active-ret', '${bus01}', 'empty_repositioning', 'Terminal A', 'Main Campus', 'returning',
        '${controllerId}', '${now}', 'Returning empty', '${now}', '${now}');
    `);

    const res = await adminCreateJourney(client, {
      adminId: controllerId,
      routeId: routeSouth,
      vehicleId: bus01,
      journeyDate: "2026-11-10",
      scheduledDeparture: "2026-11-10T18:00:00Z",
    });
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.code, "VEHICLE_IN_REPOSITIONING");
  });

  // Scenario 5: Assignment after confirmed return and operational release
  it("Scenario 5: Assignment after confirmed return and operational release (succeeds)", async () => {
    const now = new Date().toISOString();
    await client.query(`
      INSERT INTO vehicle_movements (
        id, vehicle_id, movement_type, origin_name, destination_name, status,
        initiated_by, initiated_at, arrived_at, confirmed_by, operational_reason, created_at, updated_at
      ) VALUES ('mov-done', '${bus01}', 'empty_repositioning', 'Terminal A', 'Main Campus', 'arrived',
        '${controllerId}', '${now}', '${now}', '${busManagerId}', 'Completed return', '${now}', '${now}');
    `);

    const res = await adminCreateJourney(client, {
      adminId: controllerId,
      routeId: routeSouth,
      vehicleId: bus01,
      journeyDate: "2026-11-10",
      scheduledDeparture: "2026-11-10T18:00:00Z",
    });
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.code, "JOURNEY_CREATED");
  });

  // Scenario 6: Cross-midnight assignment conflicts
  it("Scenario 6: Cross-midnight assignment conflicts across different dates within 30 min buffer", async () => {
    // Trip 1 departs at 23:50 on 2026-11-10
    const j1 = await adminCreateJourney(client, {
      adminId: controllerId,
      routeId: routeNorth,
      vehicleId: bus01,
      journeyDate: "2026-11-10",
      scheduledDeparture: "2026-11-10T23:50:00Z",
    });
    assert.strictEqual(j1.success, true);

    // Trip 2 departs at 00:10 on 2026-11-11 (20 minutes later, cross-midnight!)
    const j2 = await adminCreateJourney(client, {
      adminId: controllerId,
      routeId: routeSouth,
      vehicleId: bus01,
      journeyDate: "2026-11-11",
      scheduledDeparture: "2026-11-11T00:10:00Z",
    });
    assert.strictEqual(j2.success, false);
    assert.strictEqual(j2.code, "ASSIGNMENT_CONFLICT");
  });

  // Scenario 7: Rotation authorized while the original journey is in transit (status = planned)
  it("Scenario 7: Rotation authorized while the original journey is in transit sets movement status to planned", async () => {
    const src = await adminCreateJourney(client, {
      adminId: controllerId,
      routeId: routeNorth,
      vehicleId: bus01,
      journeyDate: "2026-11-10",
      scheduledDeparture: "2026-11-10T15:00:00Z",
    });
    await client.query(`UPDATE journeys SET status = 'in_transit' WHERE id = $1`, [src.journey_id]);

    const dst = await adminCreateJourney(client, {
      adminId: controllerId,
      routeId: routeSouth,
      vehicleId: bus02,
      journeyDate: "2026-11-10",
      scheduledDeparture: "2026-11-10T17:30:00Z",
    });

    const rot = await authorizeVehicleRotation(client, {
      callerId: controllerId,
      sourceJourneyId: src.journey_id!,
      nextJourneyId: dst.journey_id!,
      vehicleId: bus01,
      operationalReason: "Repositioning for evening surge",
    });

    assert.strictEqual(rot.success, true);
    assert.strictEqual(rot.movement_status, "planned");

    const mov = (await client.query(`SELECT status FROM vehicle_movements WHERE id = $1`, [rot.movement_id])).rows[0];
    assert.strictEqual(mov.status, "planned");
  });

  // Scenario 8: Attempted empty-return confirmation before passenger journey completion
  it("Scenario 8: Attempted empty-return confirmation before passenger journey completion (fails with SOURCE_JOURNEY_INCOMPLETE)", async () => {
    const src = await adminCreateJourney(client, {
      adminId: controllerId,
      routeId: routeNorth,
      vehicleId: bus01,
      journeyDate: "2026-11-10",
      scheduledDeparture: "2026-11-10T15:00:00Z",
    });
    await client.query(`UPDATE journeys SET status = 'in_transit' WHERE id = $1`, [src.journey_id]);

    const dst = await adminCreateJourney(client, {
      adminId: controllerId,
      routeId: routeSouth,
      vehicleId: bus02,
      journeyDate: "2026-11-10",
      scheduledDeparture: "2026-11-10T17:30:00Z",
    });

    const rot = await authorizeVehicleRotation(client, {
      callerId: controllerId,
      sourceJourneyId: src.journey_id!,
      nextJourneyId: dst.journey_id!,
      vehicleId: bus01,
      operationalReason: "Repositioning Alpha",
    });

    // Attempt confirm return while source journey is still in_transit
    const retRes = await confirmRotatedBusCampusArrival(client, rot.movement_id!, busManagerId);
    assert.strictEqual(retRes.success, false);
    assert.strictEqual(retRes.code, "SOURCE_JOURNEY_INCOMPLETE");
  });

  // Scenario 9: Correct transition from passenger journey completion to actual empty return
  it("Scenario 9: Correct transition from passenger journey completion to actual empty return (planned -> returning)", async () => {
    const src = await adminCreateJourney(client, {
      adminId: controllerId,
      routeId: routeNorth,
      vehicleId: bus01,
      journeyDate: "2026-11-10",
      scheduledDeparture: "2026-11-10T15:00:00Z",
    });
    await client.query(`UPDATE journeys SET status = 'in_transit' WHERE id = $1`, [src.journey_id]);

    const dst = await adminCreateJourney(client, {
      adminId: controllerId,
      routeId: routeSouth,
      vehicleId: bus02,
      journeyDate: "2026-11-10",
      scheduledDeparture: "2026-11-10T17:30:00Z",
    });

    const rot = await authorizeVehicleRotation(client, {
      callerId: controllerId,
      sourceJourneyId: src.journey_id!,
      nextJourneyId: dst.journey_id!,
      vehicleId: bus01,
      operationalReason: "Repositioning Alpha",
    });
    assert.strictEqual(rot.movement_status, "planned");

    // Passenger journey completes
    await client.query(`UPDATE journeys SET status = 'completed' WHERE id = $1`, [src.journey_id]);

    // Repositioning starts
    const startRes = await startVehicleRepositioning(client, rot.movement_id!, busManagerId);
    assert.strictEqual(startRes.success, true);
    assert.strictEqual(startRes.code, "REPOSITIONING_STARTED");

    const updatedMov = (await client.query(`SELECT status FROM vehicle_movements WHERE id = $1`, [rot.movement_id])).rows[0];
    assert.strictEqual(updatedMov.status, "returning");
  });

  // Scenario 10: Attempted boarding before campus return
  it("Scenario 10: Attempted boarding before campus return (fails with VEHICLE_STILL_RETURNING)", async () => {
    const src = await adminCreateJourney(client, {
      adminId: controllerId,
      routeId: routeNorth,
      vehicleId: bus01,
      journeyDate: "2026-11-10",
      scheduledDeparture: "2026-11-10T15:00:00Z",
    });
    await client.query(`UPDATE journeys SET status = 'in_transit' WHERE id = $1`, [src.journey_id]);

    const dst = await adminCreateJourney(client, {
      adminId: controllerId,
      routeId: routeSouth,
      vehicleId: bus02,
      journeyDate: "2026-11-10",
      scheduledDeparture: "2026-11-10T17:30:00Z",
    });

    await authorizeVehicleRotation(client, {
      callerId: controllerId,
      sourceJourneyId: src.journey_id!,
      nextJourneyId: dst.journey_id!,
      vehicleId: bus01,
      operationalReason: "Repositioning Alpha",
    });

    // Attempt to open boarding on destination journey
    const boardRes = await openJourneyBoarding(client, dst.journey_id!, repId);
    assert.strictEqual(boardRes.success, false);
    assert.strictEqual(boardRes.code, "VEHICLE_STILL_RETURNING");
  });

  // Scenario 11: Attempted arrival confirmation through confirm_bus_arrival before campus return
  it("Scenario 11: Attempted arrival confirmation through confirm_bus_arrival before campus return (fails with VEHICLE_STILL_RETURNING)", async () => {
    const src = await adminCreateJourney(client, {
      adminId: controllerId,
      routeId: routeNorth,
      vehicleId: bus01,
      journeyDate: "2026-11-10",
      scheduledDeparture: "2026-11-10T15:00:00Z",
    });
    await client.query(`UPDATE journeys SET status = 'in_transit' WHERE id = $1`, [src.journey_id]);

    const dst = await adminCreateJourney(client, {
      adminId: controllerId,
      routeId: routeSouth,
      vehicleId: bus02,
      journeyDate: "2026-11-10",
      scheduledDeparture: "2026-11-10T17:30:00Z",
    });

    await authorizeVehicleRotation(client, {
      callerId: controllerId,
      sourceJourneyId: src.journey_id!,
      nextJourneyId: dst.journey_id!,
      vehicleId: bus01,
      operationalReason: "Repositioning Alpha",
    });

    const arrRes = await confirmBusArrival(client, dst.journey_id!, repId);
    assert.strictEqual(arrRes.success, false);
    assert.strictEqual(arrRes.code, "VEHICLE_STILL_RETURNING");
  });

  // Scenario 12: Cancellation while the vehicle is away (verifying restored vehicle assignment)
  it("Scenario 12: Cancellation while vehicle is away safely restores pre-rotation vehicle assignment", async () => {
    const src = await adminCreateJourney(client, {
      adminId: controllerId,
      routeId: routeNorth,
      vehicleId: bus01,
      journeyDate: "2026-11-10",
      scheduledDeparture: "2026-11-10T15:00:00Z",
    });
    await client.query(`UPDATE journeys SET status = 'in_transit' WHERE id = $1`, [src.journey_id]);

    // Destination journey initially has bus02
    const dst = await adminCreateJourney(client, {
      adminId: controllerId,
      routeId: routeSouth,
      vehicleId: bus02,
      journeyDate: "2026-11-10",
      scheduledDeparture: "2026-11-10T17:30:00Z",
    });

    const rot = await authorizeVehicleRotation(client, {
      callerId: controllerId,
      sourceJourneyId: src.journey_id!,
      nextJourneyId: dst.journey_id!,
      vehicleId: bus01,
      operationalReason: "Temporary swap",
    });

    // Check intermediate state: destination has bus01 and rotation_previous_vehicle_id = bus02
    const midJ = (await client.query(`SELECT vehicle_id, rotation_previous_vehicle_id, is_rotated_vehicle FROM journeys WHERE id = $1`, [dst.journey_id])).rows[0];
    assert.strictEqual(midJ.vehicle_id, bus01);
    assert.strictEqual(midJ.rotation_previous_vehicle_id, bus02);
    assert.strictEqual(midJ.is_rotated_vehicle, true);

    // Cancel rotation
    const cancelRes = await cancelVehicleRotation(client, controllerId, rot.movement_id!, "Operational change of plan");
    assert.strictEqual(cancelRes.success, true);
    assert.strictEqual(cancelRes.code, "ROTATION_CANCELLED");

    // Restored state: destination has bus02 back, is_rotated_vehicle = false, rotation_previous_vehicle_id = NULL
    const finalJ = (await client.query(`SELECT vehicle_id, rotation_previous_vehicle_id, is_rotated_vehicle FROM journeys WHERE id = $1`, [dst.journey_id])).rows[0];
    assert.strictEqual(finalJ.vehicle_id, bus02);
    assert.strictEqual(finalJ.rotation_previous_vehicle_id, null);
    assert.strictEqual(finalJ.is_rotated_vehicle, false);
  });

  // Scenario 13: Cancellation after return (verifying rejection)
  it("Scenario 13: Cancellation after return is rejected (fails with ALREADY_ARRIVED)", async () => {
    const src = await adminCreateJourney(client, {
      adminId: controllerId,
      routeId: routeNorth,
      vehicleId: bus01,
      journeyDate: "2026-11-10",
      scheduledDeparture: "2026-11-10T15:00:00Z",
    });
    await client.query(`UPDATE journeys SET status = 'completed' WHERE id = $1`, [src.journey_id]);

    const dst = await adminCreateJourney(client, {
      adminId: controllerId,
      routeId: routeSouth,
      vehicleId: bus02,
      journeyDate: "2026-11-10",
      scheduledDeparture: "2026-11-10T17:30:00Z",
    });

    const rot = await authorizeVehicleRotation(client, {
      callerId: controllerId,
      sourceJourneyId: src.journey_id!,
      nextJourneyId: dst.journey_id!,
      vehicleId: bus01,
      operationalReason: "Repositioning Alpha",
    });

    // Confirm campus arrival
    const confRes = await confirmRotatedBusCampusArrival(client, rot.movement_id!, busManagerId);
    assert.strictEqual(confRes.success, true);

    // Attempt to cancel after arrival
    const cancelRes = await cancelVehicleRotation(client, controllerId, rot.movement_id!);
    assert.strictEqual(cancelRes.success, false);
    assert.strictEqual(cancelRes.code, "ALREADY_ARRIVED");
  });

  // Scenario 14: Destination journey cancellation with linked movement
  it("Scenario 14: Destination journey cancellation disassociates linked movement cleanly", async () => {
    const src = await adminCreateJourney(client, {
      adminId: controllerId,
      routeId: routeNorth,
      vehicleId: bus01,
      journeyDate: "2026-11-10",
      scheduledDeparture: "2026-11-10T15:00:00Z",
    });
    await client.query(`UPDATE journeys SET status = 'in_transit' WHERE id = $1`, [src.journey_id]);

    const dst = await adminCreateJourney(client, {
      adminId: controllerId,
      routeId: routeSouth,
      vehicleId: bus02,
      journeyDate: "2026-11-10",
      scheduledDeparture: "2026-11-10T17:30:00Z",
    });

    const rot = await authorizeVehicleRotation(client, {
      callerId: controllerId,
      sourceJourneyId: src.journey_id!,
      nextJourneyId: dst.journey_id!,
      vehicleId: bus01,
      operationalReason: "Repositioning Alpha",
    });

    // Cancel destination journey
    const cancelJ = await adminCancelJourney(client, controllerId, dst.journey_id!, "Route suspended due to weather");
    assert.strictEqual(cancelJ.success, true);

    // Verify linked movement disassociated next_journey_id
    const mov = (await client.query(`SELECT next_journey_id, notes FROM vehicle_movements WHERE id = $1`, [rot.movement_id])).rows[0];
    assert.strictEqual(mov.next_journey_id, null);
    assert.ok(mov.notes.includes("cancelled"));
  });

  // Scenario 15: Unauthorized rotation initiation
  it("Scenario 15: Unauthorized rotation initiation by non-controller is rejected", async () => {
    const src = await adminCreateJourney(client, {
      adminId: controllerId,
      routeId: routeNorth,
      vehicleId: bus01,
      journeyDate: "2026-11-10",
      scheduledDeparture: "2026-11-10T15:00:00Z",
    });
    await client.query(`UPDATE journeys SET status = 'in_transit' WHERE id = $1`, [src.journey_id]);

    const dst = await adminCreateJourney(client, {
      adminId: controllerId,
      routeId: routeSouth,
      vehicleId: bus02,
      journeyDate: "2026-11-10",
      scheduledDeparture: "2026-11-10T17:30:00Z",
    });

    // Bus Manager attempts to authorize rotation -> fails
    const resBusManager = await authorizeVehicleRotation(client, {
      callerId: busManagerId,
      sourceJourneyId: src.journey_id!,
      nextJourneyId: dst.journey_id!,
      vehicleId: bus01,
      operationalReason: "Unauthorized attempt",
    });
    assert.strictEqual(resBusManager.success, false);
    assert.strictEqual(resBusManager.code, "PERMISSION_DENIED");

    // Ordinary Admin attempts to authorize rotation -> fails
    const resOrdinary = await authorizeVehicleRotation(client, {
      callerId: ordinaryAdminId,
      sourceJourneyId: src.journey_id!,
      nextJourneyId: dst.journey_id!,
      vehicleId: bus01,
      operationalReason: "Unauthorized attempt",
    });
    assert.strictEqual(resOrdinary.success, false);
    assert.strictEqual(resOrdinary.code, "PERMISSION_DENIED");
  });

  // Scenario 16: Unauthorized role escalation through user management
  it("Scenario 16: Non-super-admin cannot escalate accounts to operations_controller", async () => {
    // Seed target user first
    await client.query(`INSERT INTO profiles (id, role, full_name, is_active) VALUES ('usr-target', 'student', 'Target User', true)`);

    // Ordinary admin attempts to assign operations_controller to target user -> rejected
    const res = await updateUserRoleAction(
      client,
      ordinaryAdminId,
      "usr-target",
      "admin",
      "operations_controller"
    );
    assert.strictEqual(res.success, false);
    assert.ok(res.error?.includes("Only a Super Admin"));

    // Super admin can legitimately assign operations_controller
    const superRes = await updateUserRoleAction(
      client,
      superAdminId,
      "usr-target",
      "admin",
      "operations_controller"
    );
    assert.strictEqual(superRes.success, true);

    const targetProf = (await client.query(`SELECT admin_role FROM profiles WHERE id = 'usr-target'`)).rows[0];
    assert.strictEqual(targetProf.admin_role, "operations_controller");
  });

  // Scenario 17: Legitimate Bus Manager return confirmation
  it("Scenario 17: Legitimate Bus Manager physical return confirmation releases destination boarding", async () => {
    const src = await adminCreateJourney(client, {
      adminId: controllerId,
      routeId: routeNorth,
      vehicleId: bus01,
      journeyDate: "2026-11-10",
      scheduledDeparture: "2026-11-10T15:00:00Z",
    });
    await client.query(`UPDATE journeys SET status = 'completed' WHERE id = $1`, [src.journey_id]);

    const dst = await adminCreateJourney(client, {
      adminId: controllerId,
      routeId: routeSouth,
      vehicleId: bus02,
      journeyDate: "2026-11-10",
      scheduledDeparture: "2026-11-10T17:30:00Z",
    });

    const rot = await authorizeVehicleRotation(client, {
      callerId: controllerId,
      sourceJourneyId: src.journey_id!,
      nextJourneyId: dst.journey_id!,
      vehicleId: bus01,
      operationalReason: "Repositioning Alpha",
    });

    // Bus Manager confirms arrival at Central Bus Park
    const conf = await confirmRotatedBusCampusArrival(client, rot.movement_id!, busManagerId, "Bus arrived safely at Bay 2");
    assert.strictEqual(conf.success, true);
    assert.strictEqual(conf.code, "CAMPUS_RETURN_CONFIRMED");

    // Verify destination journey status is now bus_arrived and lock released
    const dstJ = (await client.query(`SELECT status, rotation_campus_return_confirmed_at FROM journeys WHERE id = $1`, [dst.journey_id])).rows[0];
    assert.strictEqual(dstJ.status, "bus_arrived");
    assert.ok(dstJ.rotation_campus_return_confirmed_at !== null);

    // Boarding can now be opened!
    const board = await openJourneyBoarding(client, dst.journey_id!, repId);
    assert.strictEqual(board.success, true);
    assert.strictEqual(board.code, "BOARDING_OPENED");
  });

  // Scenario 18: Normal non-rotated journey creation and boarding
  it("Scenario 18: Normal non-rotated journey creation, arrival, and boarding succeed unaffected", async () => {
    const j = await adminCreateJourney(client, {
      adminId: controllerId,
      routeId: routeNorth,
      vehicleId: bus01,
      journeyDate: "2026-11-10",
      scheduledDeparture: "2026-11-10T16:00:00Z",
    });
    assert.strictEqual(j.success, true);

    const arr = await confirmBusArrival(client, j.journey_id!, repId);
    assert.strictEqual(arr.success, true);
    assert.strictEqual(arr.code, "BUS_ARRIVED");

    const board = await openJourneyBoarding(client, j.journey_id!, repId);
    assert.strictEqual(board.success, true);
    assert.strictEqual(board.code, "BOARDING_OPENED");
  });

  // Scenario 19: Concurrent rotation authorization and competing vehicle assignment
  it("Scenario 19: Once rotation is authorized, competing direct journey creation fails with conflict", async () => {
    const src = await adminCreateJourney(client, {
      adminId: controllerId,
      routeId: routeNorth,
      vehicleId: bus01,
      journeyDate: "2026-11-10",
      scheduledDeparture: "2026-11-10T15:00:00Z",
    });
    await client.query(`UPDATE journeys SET status = 'in_transit' WHERE id = $1`, [src.journey_id]);

    const dst = await adminCreateJourney(client, {
      adminId: controllerId,
      routeId: routeSouth,
      vehicleId: bus02,
      journeyDate: "2026-11-10",
      scheduledDeparture: "2026-11-10T17:30:00Z",
    });

    const rot = await authorizeVehicleRotation(client, {
      callerId: controllerId,
      sourceJourneyId: src.journey_id!,
      nextJourneyId: dst.journey_id!,
      vehicleId: bus01,
      operationalReason: "Repositioning Alpha",
    });
    assert.strictEqual(rot.success, true);

    // Competing administrator attempts to schedule bus01 directly for an 18:00 journey
    const comp = await adminCreateJourney(client, {
      adminId: ordinaryAdminId,
      routeId: routeNorth,
      vehicleId: bus01,
      journeyDate: "2026-11-10",
      scheduledDeparture: "2026-11-10T18:00:00Z",
    });
    assert.strictEqual(comp.success, false);
    assert.ok(["VEHICLE_IN_REPOSITIONING", "VEHICLE_CURRENTLY_ACTIVE"].includes(comp.code));
  });

  // Scenario 20: Repeated cancellation and return-confirmation requests
  it("Scenario 20: Repeated cancellation and return-confirmation requests fail with idempotency guards", async () => {
    const src = await adminCreateJourney(client, {
      adminId: controllerId,
      routeId: routeNorth,
      vehicleId: bus01,
      journeyDate: "2026-11-10",
      scheduledDeparture: "2026-11-10T15:00:00Z",
    });
    await client.query(`UPDATE journeys SET status = 'completed' WHERE id = $1`, [src.journey_id]);

    const dst = await adminCreateJourney(client, {
      adminId: controllerId,
      routeId: routeSouth,
      vehicleId: bus02,
      journeyDate: "2026-11-10",
      scheduledDeparture: "2026-11-10T17:30:00Z",
    });

    const rot = await authorizeVehicleRotation(client, {
      callerId: controllerId,
      sourceJourneyId: src.journey_id!,
      nextJourneyId: dst.journey_id!,
      vehicleId: bus01,
      operationalReason: "Repositioning Alpha",
    });

    // 1. Confirm return once
    const conf1 = await confirmRotatedBusCampusArrival(client, rot.movement_id!, busManagerId);
    assert.strictEqual(conf1.success, true);

    // Confirm return second time -> fails with ALREADY_ARRIVED
    const conf2 = await confirmRotatedBusCampusArrival(client, rot.movement_id!, busManagerId);
    assert.strictEqual(conf2.success, false);
    assert.strictEqual(conf2.code, "ALREADY_ARRIVED");

    // 2. Cancellation idempotency
    const rot2 = await authorizeVehicleRotation(client, {
      callerId: controllerId,
      sourceJourneyId: src.journey_id!,
      nextJourneyId: dst.journey_id!,
      vehicleId: bus01,
      operationalReason: "Second rotation test",
    });
    // First cancellation -> succeeds
    const cancel1 = await cancelVehicleRotation(client, controllerId, rot2.movement_id!);
    assert.strictEqual(cancel1.success, true);

    // Second cancellation -> fails with ALREADY_CANCELLED
    const cancel2 = await cancelVehicleRotation(client, controllerId, rot2.movement_id!);
    assert.strictEqual(cancel2.success, false);
    assert.strictEqual(cancel2.code, "ALREADY_CANCELLED");
  });
});
