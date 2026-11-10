-- ============================================================
-- COSMORIDE — MIGRATION 00018
-- Notification Type Alignment for Journey Dispatch
-- ============================================================
-- 1. Adds 'journey_update' to public.notification_type enum
-- 2. Refreshes public.confirm_journey_dispatch function
-- ============================================================

ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'journey_update';

CREATE OR REPLACE FUNCTION public.confirm_journey_dispatch(
  p_journey_id UUID,
  p_user_id UUID,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_effective_user_id UUID;
  v_jwt_role TEXT;
  v_journey RECORD;
  v_caller RECORD;
  v_now TIMESTAMPTZ := now();
  v_booking RECORD;
BEGIN
  -- 1. Trust boundary: verify authenticated session
  v_jwt_role := NULLIF(current_setting('request.jwt.claim.role', true), '');

  IF v_jwt_role IS NULL OR v_jwt_role NOT IN ('authenticated', 'service_role') THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'UNAUTHORIZED',
      'error', 'Permission denied: Invalid or untrusted execution context.'
    );
  END IF;

  IF v_jwt_role = 'authenticated' THEN
    IF auth.uid() IS NULL THEN
      RETURN jsonb_build_object('success', false, 'code', 'UNAUTHORIZED', 'error', 'Permission denied: Unauthenticated session.');
    END IF;
    IF p_user_id IS NOT NULL AND p_user_id <> auth.uid() THEN
      RETURN jsonb_build_object('success', false, 'code', 'IDENTITY_MISMATCH', 'error', 'Identity mismatch: Caller cannot record dispatch under another identity.');
    END IF;
    v_effective_user_id := auth.uid();
  ELSE
    IF p_user_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'code', 'MISSING_ACTOR', 'error', 'Service role execution requires explicit user actor attribution.');
    END IF;
    v_effective_user_id := p_user_id;
  END IF;

  -- 2. Verify caller role
  SELECT * INTO v_caller
  FROM public.profiles
  WHERE id = v_effective_user_id;

  IF NOT FOUND OR v_caller.role NOT IN ('boarding_officer', 'admin', 'driver') THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'FORBIDDEN',
      'error', 'Permission denied: Only authorised staff may record journey departure.'
    );
  END IF;

  -- 3. Lock Journey
  SELECT j.*, r.transport_group_id, r.name AS route_name, r.code AS route_code
  INTO v_journey
  FROM public.journeys j
  JOIN public.routes r ON r.id = j.route_id
  WHERE j.id = p_journey_id
  FOR UPDATE OF j;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'code', 'JOURNEY_NOT_FOUND', 'error', 'Journey record not found.');
  END IF;

  -- 4. Check transport group isolation for boarding officers
  IF v_caller.role = 'boarding_officer' THEN
    IF v_caller.assigned_transport_group_id IS NULL OR v_journey.transport_group_id IS DISTINCT FROM v_caller.assigned_transport_group_id THEN
      RETURN jsonb_build_object(
        'success', false,
        'code', 'CROSS_GROUP_DENIED',
        'error', 'Cross-Group Restriction: You cannot dispatch a route outside your assigned hostel operation.'
      );
    END IF;
  END IF;

  -- Assigned driver check
  IF v_caller.role = 'driver' THEN
    IF v_journey.driver_id IS DISTINCT FROM v_effective_user_id THEN
      RETURN jsonb_build_object(
        'success', false,
        'code', 'UNASSIGNED_DRIVER',
        'error', 'Permission denied: You are not assigned to drive this journey.'
      );
    END IF;
  END IF;

  -- 5. Validate status: journey must be ready for departure ('ready_to_depart', 'boarding_closed', or 'boarding')
  IF v_journey.status IN ('in_transit', 'completed') THEN
    RETURN jsonb_build_object(
      'success', true,
      'code', 'ALREADY_DEPARTED',
      'status', v_journey.status,
      'actual_departure', v_journey.actual_departure,
      'message', 'Journey has already departed.'
    );
  END IF;

  IF v_journey.status = 'cancelled' THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'JOURNEY_CANCELLED',
      'error', 'Cannot dispatch: This journey was cancelled.'
    );
  END IF;

  -- 6. Transition to in_transit
  UPDATE public.journeys
  SET status = 'in_transit',
      actual_departure = v_now,
      departure_authorised_at = COALESCE(departure_authorised_at, v_now),
      departure_authorised_by = COALESCE(departure_authorised_by, v_effective_user_id),
      departure_confirmed_by = v_effective_user_id,
      updated_at = v_now
  WHERE id = p_journey_id;

  -- 7. Audit log
  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, details)
  VALUES (
    v_effective_user_id,
    'JOURNEY_DEPARTED',
    'journey',
    p_journey_id,
    jsonb_build_object(
      'journey_id', p_journey_id,
      'route_code', v_journey.route_code,
      'actual_departure', v_now,
      'confirmed_by', v_effective_user_id,
      'notes', p_notes
    )
  );

  -- 8. Notify booked students on this journey using valid notification_type
  FOR v_booking IN
    SELECT b.student_id
    FROM public.bookings b
    WHERE b.journey_id = p_journey_id AND b.status IN ('checked_in', 'confirmed')
  LOOP
    INSERT INTO public.notifications (user_id, title, message, type)
    VALUES (
      v_booking.student_id,
      'Bus Departed: ' || v_journey.route_name,
      'Your scheduled bus on route ' || v_journey.route_name || ' has departed from the terminal.',
      'announcement'::public.notification_type
    );
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'code', 'DEPARTED',
    'status', 'in_transit',
    'actual_departure', v_now,
    'message', 'Journey departed successfully. Students notified.'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.confirm_journey_dispatch(UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_journey_dispatch(UUID, UUID, TEXT) TO service_role;
