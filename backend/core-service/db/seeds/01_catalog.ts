import type { Knex } from 'knex';

/**
 * CA-01 — Seed: Catalog data (movies, cinemas, auditoriums, seat_pairs, seats)
 * Owner: TV2 (Nguyễn Bá Quốc Học)
 *
 * Vietnamese cinema data with couple seats (D-15).
 * Required showtime seed date: 20/12/2026 19:30 Asia/Ho_Chi_Minh (D-16) — handled by TV3.
 */

// Fixed UUIDs for deterministic seeding and cross-service references
const MOVIE_IDS = {
  movie1: '11111111-1111-1111-1111-111111111101',
  movie2: '11111111-1111-1111-1111-111111111102',
  movie3: '11111111-1111-1111-1111-111111111103',
};

const CINEMA_IDS = {
  cinema1: '22222222-2222-2222-2222-222222222201',
  cinema2: '22222222-2222-2222-2222-222222222202',
};

const AUDITORIUM_IDS = {
  aud1: '33333333-3333-3333-3333-333333333301', // Cinema 1 — Phòng 1 (standard, 2D)
  aud2: '33333333-3333-3333-3333-333333333302', // Cinema 1 — Phòng IMAX
  aud3: '33333333-3333-3333-3333-333333333303', // Cinema 2 — Phòng 1
};

const SEAT_PAIR_IDS = {
  pair1_aud1: '44444444-4444-4444-4444-444444444401', // Auditorium 1, couple pair 1
  pair2_aud1: '44444444-4444-4444-4444-444444444402', // Auditorium 1, couple pair 2
  pair1_aud3: '44444444-4444-4444-4444-444444444403', // Auditorium 3, couple pair 1
};

export async function seed(knex: Knex): Promise<void> {
  // Clean in reverse dependency order
  await knex('seats').del();
  await knex('seat_pairs').del();
  await knex('auditoriums').del();
  await knex('cinemas').del();
  await knex('movies').del();

  // ── Movies ──
  await knex('movies').insert([
    {
      id: MOVIE_IDS.movie1,
      title: 'Lật Mặt 8: Vòng Tay Nắng',
      synopsis: 'Phần 8 của loạt phim Lật Mặt, câu chuyện cảm động về gia đình Việt Nam.',
      duration_min: 130,
      age_rating: 'C13',
      poster_url: 'https://example.com/posters/lat-mat-8.jpg',
      director: 'Lý Hải',
      genres: ['drama', 'family'],
      release_date: '2026-12-01',
      language: 'Tiếng Việt',
      status: 'active',
    },
    {
      id: MOVIE_IDS.movie2,
      title: 'Avengers: Secret Wars',
      synopsis: 'The ultimate battle across the multiverse.',
      duration_min: 165,
      age_rating: 'C13',
      poster_url: 'https://example.com/posters/avengers-sw.jpg',
      director: 'Anthony Russo',
      genres: ['action', 'sci-fi'],
      release_date: '2026-12-15',
      language: 'English',
      status: 'active',
    },
    {
      id: MOVIE_IDS.movie3,
      title: 'Mai 2',
      synopsis: 'Phần tiếp theo của câu chuyện Mai.',
      duration_min: 115,
      age_rating: 'C16',
      poster_url: 'https://example.com/posters/mai-2.jpg',
      director: 'Trấn Thành',
      genres: ['drama', 'romance'],
      release_date: '2027-01-10',
      language: 'Tiếng Việt',
      status: 'coming_soon',
    },
  ]);

  // ── Cinemas ──
  await knex('cinemas').insert([
    {
      id: CINEMA_IDS.cinema1,
      name: 'CineStar Quận 1',
      address: '271 Nguyễn Trãi, Phường Nguyễn Cư Trinh',
      city: 'Hồ Chí Minh',
      phone: '028-3836-1515',
      status: 'active',
    },
    {
      id: CINEMA_IDS.cinema2,
      name: 'CineStar Quận 7',
      address: '20 Nguyễn Lương Bằng, Phú Mỹ Hưng',
      city: 'Hồ Chí Minh',
      phone: '028-5413-5678',
      status: 'active',
    },
  ]);

  // ── Auditoriums ──
  await knex('auditoriums').insert([
    {
      id: AUDITORIUM_IDS.aud1,
      cinema_id: CINEMA_IDS.cinema1,
      name: 'Phòng 1',
      supported_formats: knex.raw("ARRAY['2D', '3D']"),
      total_seats: 0, // Will be updated after seeding seats
      status: 'active',
    },
    {
      id: AUDITORIUM_IDS.aud2,
      cinema_id: CINEMA_IDS.cinema1,
      name: 'Phòng IMAX',
      supported_formats: knex.raw("ARRAY['2D', '3D', 'IMAX']"),
      total_seats: 0,
      status: 'active',
    },
    {
      id: AUDITORIUM_IDS.aud3,
      cinema_id: CINEMA_IDS.cinema2,
      name: 'Phòng 1',
      supported_formats: knex.raw("ARRAY['2D']"),
      total_seats: 0,
      status: 'active',
    },
  ]);

  // ── Seat Pairs (D-15: couple seats, 2 seat IDs per pair) ──
  await knex('seat_pairs').insert([
    { id: SEAT_PAIR_IDS.pair1_aud1, auditorium_id: AUDITORIUM_IDS.aud1 },
    { id: SEAT_PAIR_IDS.pair2_aud1, auditorium_id: AUDITORIUM_IDS.aud1 },
    { id: SEAT_PAIR_IDS.pair1_aud3, auditorium_id: AUDITORIUM_IDS.aud3 },
  ]);

  // ── Seats ──
  // Auditorium 1 (CineStar Q1 — Phòng 1):
  //   Rows A-D (8 seats each = 32 standard)
  //   Row E (6 VIP)
  //   Row F (4 couple seats = 2 pairs)
  //   Total: 42 seats
  const aud1Seats: Array<Record<string, unknown>> = [];

  // Standard seats: Rows A-D, seats 1-8
  for (const row of ['A', 'B', 'C', 'D']) {
    for (let num = 1; num <= 8; num++) {
      aud1Seats.push({
        auditorium_id: AUDITORIUM_IDS.aud1,
        row_label: row,
        seat_number: num,
        seat_type: 'standard',
        couple_pair_id: null,
        is_active: true,
      });
    }
  }

  // VIP seats: Row E, seats 1-6
  for (let num = 1; num <= 6; num++) {
    aud1Seats.push({
      auditorium_id: AUDITORIUM_IDS.aud1,
      row_label: 'E',
      seat_number: num,
      seat_type: 'vip',
      couple_pair_id: null,
      is_active: true,
    });
  }

  // Couple seats: Row F, pairs (1,2) and (3,4) — D-15
  aud1Seats.push(
    {
      auditorium_id: AUDITORIUM_IDS.aud1,
      row_label: 'F',
      seat_number: 1,
      seat_type: 'couple',
      couple_pair_id: SEAT_PAIR_IDS.pair1_aud1,
      is_active: true,
    },
    {
      auditorium_id: AUDITORIUM_IDS.aud1,
      row_label: 'F',
      seat_number: 2,
      seat_type: 'couple',
      couple_pair_id: SEAT_PAIR_IDS.pair1_aud1,
      is_active: true,
    },
    {
      auditorium_id: AUDITORIUM_IDS.aud1,
      row_label: 'F',
      seat_number: 3,
      seat_type: 'couple',
      couple_pair_id: SEAT_PAIR_IDS.pair2_aud1,
      is_active: true,
    },
    {
      auditorium_id: AUDITORIUM_IDS.aud1,
      row_label: 'F',
      seat_number: 4,
      seat_type: 'couple',
      couple_pair_id: SEAT_PAIR_IDS.pair2_aud1,
      is_active: true,
    },
  );

  await knex('seats').insert(aud1Seats);

  // Auditorium 2 (CineStar Q1 — IMAX): Rows A-C, 10 seats each = 30 standard
  const aud2Seats: Array<Record<string, unknown>> = [];
  for (const row of ['A', 'B', 'C']) {
    for (let num = 1; num <= 10; num++) {
      aud2Seats.push({
        auditorium_id: AUDITORIUM_IDS.aud2,
        row_label: row,
        seat_number: num,
        seat_type: 'standard',
        couple_pair_id: null,
        is_active: true,
      });
    }
  }
  await knex('seats').insert(aud2Seats);

  // Auditorium 3 (CineStar Q7 — Phòng 1):
  //   Rows A-B (6 seats each = 12 standard)
  //   Row C (2 couple = 1 pair)
  //   Total: 14 seats
  const aud3Seats: Array<Record<string, unknown>> = [];
  for (const row of ['A', 'B']) {
    for (let num = 1; num <= 6; num++) {
      aud3Seats.push({
        auditorium_id: AUDITORIUM_IDS.aud3,
        row_label: row,
        seat_number: num,
        seat_type: 'standard',
        couple_pair_id: null,
        is_active: true,
      });
    }
  }
  aud3Seats.push(
    {
      auditorium_id: AUDITORIUM_IDS.aud3,
      row_label: 'C',
      seat_number: 1,
      seat_type: 'couple',
      couple_pair_id: SEAT_PAIR_IDS.pair1_aud3,
      is_active: true,
    },
    {
      auditorium_id: AUDITORIUM_IDS.aud3,
      row_label: 'C',
      seat_number: 2,
      seat_type: 'couple',
      couple_pair_id: SEAT_PAIR_IDS.pair1_aud3,
      is_active: true,
    },
  );
  await knex('seats').insert(aud3Seats);

  // ── Update auditorium total_seats counts ──
  await knex.raw(`
    UPDATE auditoriums
    SET total_seats = sub.cnt
    FROM (
      SELECT auditorium_id, COUNT(*)::int AS cnt
      FROM seats
      WHERE is_active = true
      GROUP BY auditorium_id
    ) sub
    WHERE auditoriums.id = sub.auditorium_id
  `);
}
