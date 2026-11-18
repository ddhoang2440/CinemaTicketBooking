-- =============================================================================
-- Cinema Ticket Booking System — PostgreSQL 17 Initialization
-- ACCEPTED — REVISED D-04: One PostgreSQL instance with 3 separate service-owned schemas.
-- Do NOT create business tables or cross-schema foreign keys here.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS core;
CREATE SCHEMA IF NOT EXISTS payment;
CREATE SCHEMA IF NOT EXISTS notification;

-- Extensions required by ERD / DATABASE-IMPLEMENTATION.md (UUIDs & GiST exclusion for D-11)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "btree_gist";
