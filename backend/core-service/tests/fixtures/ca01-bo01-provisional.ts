import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';

/**
 * ============================================================================
 * PROVISIONAL TEST-ONLY FIXTURE HELPERS — DO NOT MOVE TO db/migrations/
 * ============================================================================
 * Simulates TV2 (CA-01: movies, cinemas, auditoriums, seat_pairs, seats) and
 * TV4 (BO-01: bookings + deferred fk_seat_allocations_booking) exclusively inside
 * an ephemeral disposable PostgreSQL 17 test container for SH-01 verification.
 *
 * Production migrations remain BLOCKED until TV2 merges real CA-01 migrations.
 * ============================================================================
 */

export interface ProvisionalCatalogSeed {
  movieId: string;
  cinemaId: string;
  otherCinemaId: string;
  auditoriumAId: string;
  auditoriumBId: string;
  otherCinemaAuditoriumId: string;
  seatPairAId: string;
  seatA1Id: string;
  seatA2Id: string;
  seatCoupleLeftId: string;
  seatCoupleRightId: string;
  seatB1Id: string;
}

export async function ensureCoreTestSchemasAndExtensions(knex: Knex): Promise<void> {
  await knex.raw('CREATE SCHEMA IF NOT EXISTS core');
  await knex.raw('CREATE SCHEMA IF NOT EXISTS payment');
  await knex.raw('CREATE SCHEMA IF NOT EXISTS notification');
  await knex.raw('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
  await knex.raw('CREATE EXTENSION IF NOT EXISTS "btree_gist"');
}

export async function provisionProvisionalCa01Tables(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS core.movies (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      title VARCHAR(255) NOT NULL,
      duration_min INTEGER NOT NULL CHECK (duration_min > 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await knex.raw(`
    CREATE TABLE IF NOT EXISTS core.cinemas (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(255) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await knex.raw(`
    CREATE TABLE IF NOT EXISTS core.auditoriums (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      cinema_id UUID NOT NULL REFERENCES core.cinemas(id) ON DELETE RESTRICT,
      name VARCHAR(100) NOT NULL,
      supported_formats TEXT[] NOT NULL DEFAULT ARRAY['2D'],
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT uq_auditoriums_id_cinema UNIQUE (id, cinema_id)
    )
  `);

  await knex.raw(`
    CREATE TABLE IF NOT EXISTS core.seat_pairs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      auditorium_id UUID NOT NULL REFERENCES core.auditoriums(id) ON DELETE RESTRICT,
      pair_code VARCHAR(20) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT uq_seat_pairs_id_auditorium UNIQUE (id, auditorium_id)
    )
  `);

  await knex.raw(`
    CREATE TABLE IF NOT EXISTS core.seats (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      auditorium_id UUID NOT NULL REFERENCES core.auditoriums(id) ON DELETE RESTRICT,
      row_label VARCHAR(10) NOT NULL,
      seat_number INTEGER NOT NULL,
      seat_type VARCHAR(20) NOT NULL CHECK (seat_type IN ('standard', 'vip', 'couple')),
      couple_pair_id UUID NULL,
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT uq_seats_auditorium_row_num UNIQUE (auditorium_id, row_label, seat_number),
      CONSTRAINT uq_seats_id_auditorium UNIQUE (id, auditorium_id),
      CONSTRAINT fk_seats_couple_pair
        FOREIGN KEY (couple_pair_id, auditorium_id)
        REFERENCES core.seat_pairs(id, auditorium_id)
        ON DELETE RESTRICT
    )
  `);
}

export async function dropProvisionalCa01Tables(knex: Knex): Promise<void> {
  await knex.raw('DROP TABLE IF EXISTS core.seats');
  await knex.raw('DROP TABLE IF EXISTS core.seat_pairs');
  await knex.raw('DROP TABLE IF EXISTS core.auditoriums');
  await knex.raw('DROP TABLE IF EXISTS core.cinemas');
  await knex.raw('DROP TABLE IF EXISTS core.movies');
}

export async function provisionProvisionalBo01Tables(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS core.bookings (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      hold_group_id UUID NOT NULL REFERENCES core.seat_hold_groups(id) ON DELETE RESTRICT,
      status VARCHAR(30) NOT NULL DEFAULT 'confirmed',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await knex.raw(`
    ALTER TABLE core.seat_allocations
      ADD CONSTRAINT fk_seat_allocations_booking
      FOREIGN KEY (booking_id)
      REFERENCES core.bookings(id)
      ON DELETE RESTRICT
  `);
}

export async function dropProvisionalBo01Tables(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TABLE IF EXISTS core.seat_allocations
      DROP CONSTRAINT IF EXISTS fk_seat_allocations_booking
  `);
  await knex.raw('DROP TABLE IF EXISTS core.bookings');
}

export async function seedProvisionalCatalog(knex: Knex): Promise<ProvisionalCatalogSeed> {
  const seed: ProvisionalCatalogSeed = {
    movieId: randomUUID(),
    cinemaId: randomUUID(),
    otherCinemaId: randomUUID(),
    auditoriumAId: randomUUID(),
    auditoriumBId: randomUUID(),
    otherCinemaAuditoriumId: randomUUID(),
    seatPairAId: randomUUID(),
    seatA1Id: randomUUID(),
    seatA2Id: randomUUID(),
    seatCoupleLeftId: randomUUID(),
    seatCoupleRightId: randomUUID(),
    seatB1Id: randomUUID(),
  };

  await knex('core.movies').insert({
    id: seed.movieId,
    title: 'Provisional Test Movie (SH-01)',
    duration_min: 120,
  });

  await knex('core.cinemas').insert([
    { id: seed.cinemaId, name: 'Provisional Cinema Alpha' },
    { id: seed.otherCinemaId, name: 'Provisional Cinema Beta' },
  ]);

  await knex('core.auditoriums').insert([
    {
      id: seed.auditoriumAId,
      cinema_id: seed.cinemaId,
      name: 'Hall 1',
      supported_formats: ['2D', '3D', 'IMAX'],
    },
    {
      id: seed.auditoriumBId,
      cinema_id: seed.cinemaId,
      name: 'Hall 2',
      supported_formats: ['2D'],
    },
    {
      id: seed.otherCinemaAuditoriumId,
      cinema_id: seed.otherCinemaId,
      name: 'Beta Hall 1',
      supported_formats: ['2D'],
    },
  ]);

  await knex('core.seat_pairs').insert({
    id: seed.seatPairAId,
    auditorium_id: seed.auditoriumAId,
    pair_code: 'C1-C2',
  });

  await knex('core.seats').insert([
    {
      id: seed.seatA1Id,
      auditorium_id: seed.auditoriumAId,
      row_label: 'A',
      seat_number: 1,
      seat_type: 'standard',
      couple_pair_id: null,
    },
    {
      id: seed.seatA2Id,
      auditorium_id: seed.auditoriumAId,
      row_label: 'A',
      seat_number: 2,
      seat_type: 'vip',
      couple_pair_id: null,
    },
    {
      id: seed.seatCoupleLeftId,
      auditorium_id: seed.auditoriumAId,
      row_label: 'C',
      seat_number: 1,
      seat_type: 'couple',
      couple_pair_id: seed.seatPairAId,
    },
    {
      id: seed.seatCoupleRightId,
      auditorium_id: seed.auditoriumAId,
      row_label: 'C',
      seat_number: 2,
      seat_type: 'couple',
      couple_pair_id: seed.seatPairAId,
    },
    {
      id: seed.seatB1Id,
      auditorium_id: seed.auditoriumBId,
      row_label: 'A',
      seat_number: 1,
      seat_type: 'standard',
      couple_pair_id: null,
    },
  ]);

  return seed;
}

