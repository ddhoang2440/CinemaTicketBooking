import type { Knex } from 'knex';

/**
 * CA-01 — Idempotent Seed Data: Movies, Cinemas, Auditoriums, Seat Pairs & Seats
 * Owner: TV2 (Nguyễn Bá Quốc Học)
 *
 * Vietnamese locale content per ERD §1 & DATABASE-IMPLEMENTATION.md §6.
 * Fixed UUIDs allow downstream seeds (TV3 showtimes, TV4 bookings) to reference
 * catalog entities deterministically, and ON CONFLICT upserts make re-seeding
 * 100% non-destructive even when downstream foreign keys reference catalog rows.
 */

// ── Fixed UUIDs for cross-module reference ──────────────────────────
export const MOVIE_IDS = {
  mai: '10000000-0000-4000-8000-000000000001',
  lat_mat_7: '10000000-0000-4000-8000-000000000002',
  dune_2: '10000000-0000-4000-8000-000000000003',
  inside_out_2: '10000000-0000-4000-8000-000000000004',
  deadpool_3: '10000000-0000-4000-8000-000000000005',
} as const;

export const CINEMA_IDS = {
  hcm_q1: '20000000-0000-4000-8000-000000000001',
  hcm_q7: '20000000-0000-4000-8000-000000000002',
  hn_ba_dinh: '20000000-0000-4000-8000-000000000003',
} as const;

export const AUDITORIUM_IDS = {
  hcm_q1_room1: '30000000-0000-4000-8000-000000000001',
  hcm_q1_room2: '30000000-0000-4000-8000-000000000002',
  hcm_q7_room1: '30000000-0000-4000-8000-000000000003',
  hn_bd_room1: '30000000-0000-4000-8000-000000000004',
} as const;

export const SEAT_PAIR_IDS = {
  pair1_aud1: '40000000-0000-4000-8000-000000000001',
  pair2_aud1: '40000000-0000-4000-8000-000000000002',
  pair1_aud3: '40000000-0000-4000-8000-000000000003',
} as const;

function deterministicSeatId(index: number): string {
  return `50000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
}

export async function seed(knex: Knex): Promise<void> {
  // ── 1. Movies ───────────────────────────────────────────────────────
  await knex
    .withSchema('core')
    .into('movies')
    .insert([
      {
        id: MOVIE_IDS.mai,
        title: 'Mai',
        synopsis:
          'Câu chuyện về Mai — người phụ nữ gần 40 tuổi làm nghề massage, tình cờ gặp Dương — chàng trai trẻ đào hoa. Tình yêu đến mang theo những vết thương quá khứ.',
        duration_min: 131,
        age_rating: 'C18',
        poster_url: 'https://placehold.co/300x450/1a1a2e/e94560?text=MAI',
        release_date: '2026-02-10',
        status: 'active',
      },
      {
        id: MOVIE_IDS.lat_mat_7,
        title: 'Lật Mặt 7: Một Điều Ước',
        synopsis:
          'Bà Hai 73 tuổi sống một mình ở vùng quê, năm người con đều đã trưởng thành và lập nghiệp xa nhà. Khi biến cố ập đến, ai sẽ là người chăm sóc mẹ?',
        duration_min: 138,
        age_rating: 'P',
        poster_url: 'https://placehold.co/300x450/1a1a2e/0f3460?text=LAT+MAT+7',
        release_date: '2026-04-26',
        status: 'active',
      },
      {
        id: MOVIE_IDS.dune_2,
        title: 'Hành Tinh Cát: Phần Hai',
        synopsis:
          'Paul Atreides hợp lực cùng Chani và người Fremen trên hành trình trả thù những kẻ đã hủy hoại gia tộc anh, đồng thời ngăn chặn tương lai khủng khiếp mà chỉ anh nhìn thấy.',
        duration_min: 166,
        age_rating: 'C13',
        poster_url: 'https://placehold.co/300x450/1a1a2e/e94560?text=DUNE+2',
        release_date: '2026-03-01',
        status: 'active',
      },
      {
        id: MOVIE_IDS.inside_out_2,
        title: 'Những Mảnh Ghép Cảm Xúc 2',
        synopsis:
          'Riley bước vào tuổi dậy thì và Trung tâm Điều khiển phải đón nhận những cảm xúc hoàn toàn mới: Lo Âu, Ganh Tị, Chán Nản và Xấu Hổ.',
        duration_min: 96,
        age_rating: 'P',
        poster_url: 'https://placehold.co/300x450/1a1a2e/16213e?text=INSIDE+OUT+2',
        release_date: '2026-06-14',
        status: 'active',
      },
      {
        id: MOVIE_IDS.deadpool_3,
        title: 'Deadpool & Wolverine',
        synopsis:
          'Wade Wilson bị tổ chức TVA kéo ra khỏi cuộc sống yên bình và phải hợp tác cùng một Wolverine bất đắc dĩ để cứu lấy đa vũ trụ.',
        duration_min: 128,
        age_rating: 'C18',
        poster_url: 'https://placehold.co/300x450/1a1a2e/e94560?text=DEADPOOL+3',
        release_date: '2026-12-25',
        status: 'coming_soon',
      },
    ])
    .onConflict('id')
    .merge({
      title: knex.raw('excluded.title'),
      synopsis: knex.raw('excluded.synopsis'),
      duration_min: knex.raw('excluded.duration_min'),
      age_rating: knex.raw('excluded.age_rating'),
      poster_url: knex.raw('excluded.poster_url'),
      release_date: knex.raw('excluded.release_date'),
      status: knex.raw('excluded.status'),
      updated_at: knex.fn.now(),
    });

  // ── 2. Cinemas ──────────────────────────────────────────────────────
  await knex
    .withSchema('core')
    .into('cinemas')
    .insert([
      {
        id: CINEMA_IDS.hcm_q1,
        name: 'Cinema Sài Gòn Center',
        address: '65 Lê Lợi, Phường Bến Nghé, Quận 1',
        city: 'Hồ Chí Minh',
        status: 'active',
      },
      {
        id: CINEMA_IDS.hcm_q7,
        name: 'Cinema Crescent Mall',
        address: '101 Tôn Dật Tiên, Phường Tân Phú, Quận 7',
        city: 'Hồ Chí Minh',
        status: 'active',
      },
      {
        id: CINEMA_IDS.hn_ba_dinh,
        name: 'Cinema Lotte Hà Nội',
        address: '54 Liễu Giai, Phường Cống Vị, Quận Ba Đình',
        city: 'Hà Nội',
        status: 'active',
      },
    ])
    .onConflict('id')
    .merge({
      name: knex.raw('excluded.name'),
      address: knex.raw('excluded.address'),
      city: knex.raw('excluded.city'),
      status: knex.raw('excluded.status'),
      updated_at: knex.fn.now(),
    });

  // ── 3. Auditoriums ─────────────────────────────────────────────────
  await knex
    .withSchema('core')
    .into('auditoriums')
    .insert([
      {
        id: AUDITORIUM_IDS.hcm_q1_room1,
        cinema_id: CINEMA_IDS.hcm_q1,
        name: 'Phòng 1 — IMAX Laser',
        total_seats: 24,
        supported_formats: knex.raw("ARRAY['2D', '3D', 'IMAX']::text[]"),
        status: 'active',
      },
      {
        id: AUDITORIUM_IDS.hcm_q1_room2,
        cinema_id: CINEMA_IDS.hcm_q1,
        name: 'Phòng 2 — Standard',
        total_seats: 20,
        supported_formats: knex.raw("ARRAY['2D']::text[]"),
        status: 'active',
      },
      {
        id: AUDITORIUM_IDS.hcm_q7_room1,
        cinema_id: CINEMA_IDS.hcm_q7,
        name: 'Phòng 1 — Dolby Atmos',
        total_seats: 20,
        supported_formats: knex.raw("ARRAY['2D', '3D']::text[]"),
        status: 'active',
      },
      {
        id: AUDITORIUM_IDS.hn_bd_room1,
        cinema_id: CINEMA_IDS.hn_ba_dinh,
        name: 'Phòng 1 — Gold Class',
        total_seats: 16,
        supported_formats: knex.raw("ARRAY['2D', '3D']::text[]"),
        status: 'active',
      },
    ])
    .onConflict('id')
    .merge({
      cinema_id: knex.raw('excluded.cinema_id'),
      name: knex.raw('excluded.name'),
      total_seats: knex.raw('excluded.total_seats'),
      supported_formats: knex.raw('excluded.supported_formats'),
      status: knex.raw('excluded.status'),
      updated_at: knex.fn.now(),
    });

  // ── 4. Seat Pairs (D-15: couple seats linked in pairs of 2) ────────
  await knex
    .withSchema('core')
    .into('seat_pairs')
    .insert([
      {
        id: SEAT_PAIR_IDS.pair1_aud1,
        auditorium_id: AUDITORIUM_IDS.hcm_q1_room1,
      },
      {
        id: SEAT_PAIR_IDS.pair2_aud1,
        auditorium_id: AUDITORIUM_IDS.hcm_q1_room1,
      },
      {
        id: SEAT_PAIR_IDS.pair1_aud3,
        auditorium_id: AUDITORIUM_IDS.hcm_q7_room1,
      },
    ])
    .onConflict('id')
    .merge({
      auditorium_id: knex.raw('excluded.auditorium_id'),
    });

  // ── 5. Seats ────────────────────────────────────────────────────────
  const seats: Array<{
    id: string;
    auditorium_id: string;
    row_label: string;
    seat_number: number;
    seat_type: string;
    couple_pair_id: string | null;
    is_active: boolean;
  }> = [];

  let seatSeq = 1;

  // --- Auditorium 1 (Cinema Q1, Phòng 1 — IMAX): 24 seats ---
  for (const row of ['A', 'B']) {
    for (let num = 1; num <= 6; num++) {
      seats.push({
        id: deterministicSeatId(seatSeq++),
        auditorium_id: AUDITORIUM_IDS.hcm_q1_room1,
        row_label: row,
        seat_number: num,
        seat_type: 'standard',
        couple_pair_id: null,
        is_active: true,
      });
    }
  }

  for (let num = 1; num <= 8; num++) {
    seats.push({
      id: deterministicSeatId(seatSeq++),
      auditorium_id: AUDITORIUM_IDS.hcm_q1_room1,
      row_label: 'C',
      seat_number: num,
      seat_type: 'vip',
      couple_pair_id: null,
      is_active: true,
    });
  }

  seats.push(
    {
      id: deterministicSeatId(seatSeq++),
      auditorium_id: AUDITORIUM_IDS.hcm_q1_room1,
      row_label: 'D',
      seat_number: 1,
      seat_type: 'couple',
      couple_pair_id: SEAT_PAIR_IDS.pair1_aud1,
      is_active: true,
    },
    {
      id: deterministicSeatId(seatSeq++),
      auditorium_id: AUDITORIUM_IDS.hcm_q1_room1,
      row_label: 'D',
      seat_number: 2,
      seat_type: 'couple',
      couple_pair_id: SEAT_PAIR_IDS.pair1_aud1,
      is_active: true,
    },
    {
      id: deterministicSeatId(seatSeq++),
      auditorium_id: AUDITORIUM_IDS.hcm_q1_room1,
      row_label: 'D',
      seat_number: 3,
      seat_type: 'couple',
      couple_pair_id: SEAT_PAIR_IDS.pair2_aud1,
      is_active: true,
    },
    {
      id: deterministicSeatId(seatSeq++),
      auditorium_id: AUDITORIUM_IDS.hcm_q1_room1,
      row_label: 'D',
      seat_number: 4,
      seat_type: 'couple',
      couple_pair_id: SEAT_PAIR_IDS.pair2_aud1,
      is_active: true,
    },
  );

  // --- Auditorium 2 (Cinema Q1, Phòng 2 — Standard): 20 seats ---
  for (const row of ['A', 'B', 'C', 'D']) {
    const seatType = row === 'D' ? 'vip' : 'standard';
    for (let num = 1; num <= 5; num++) {
      seats.push({
        id: deterministicSeatId(seatSeq++),
        auditorium_id: AUDITORIUM_IDS.hcm_q1_room2,
        row_label: row,
        seat_number: num,
        seat_type: seatType,
        couple_pair_id: null,
        is_active: true,
      });
    }
  }

  // --- Auditorium 3 (Cinema Q7, Phòng 1 — Dolby Atmos): 22 seats ---
  for (const row of ['A', 'B', 'C']) {
    const seatType = row === 'C' ? 'vip' : 'standard';
    for (let num = 1; num <= 6; num++) {
      seats.push({
        id: deterministicSeatId(seatSeq++),
        auditorium_id: AUDITORIUM_IDS.hcm_q7_room1,
        row_label: row,
        seat_number: num,
        seat_type: seatType,
        couple_pair_id: null,
        is_active: true,
      });
    }
  }

  seats.push(
    {
      id: deterministicSeatId(seatSeq++),
      auditorium_id: AUDITORIUM_IDS.hcm_q7_room1,
      row_label: 'D',
      seat_number: 1,
      seat_type: 'couple',
      couple_pair_id: SEAT_PAIR_IDS.pair1_aud3,
      is_active: true,
    },
    {
      id: deterministicSeatId(seatSeq++),
      auditorium_id: AUDITORIUM_IDS.hcm_q7_room1,
      row_label: 'D',
      seat_number: 2,
      seat_type: 'couple',
      couple_pair_id: SEAT_PAIR_IDS.pair1_aud3,
      is_active: true,
    },
  );

  // --- Auditorium 4 (Cinema HN Ba Đình, Phòng 1 — Gold Class): 16 seats ---
  for (const row of ['A', 'B', 'C', 'D']) {
    const seatType = row === 'C' || row === 'D' ? 'vip' : 'standard';
    for (let num = 1; num <= 4; num++) {
      seats.push({
        id: deterministicSeatId(seatSeq++),
        auditorium_id: AUDITORIUM_IDS.hn_bd_room1,
        row_label: row,
        seat_number: num,
        seat_type: seatType,
        couple_pair_id: null,
        is_active: true,
      });
    }
  }

  await knex
    .withSchema('core')
    .into('seats')
    .insert(seats)
    .onConflict(['auditorium_id', 'row_label', 'seat_number'])
    .merge({
      seat_type: knex.raw('excluded.seat_type'),
      couple_pair_id: knex.raw('excluded.couple_pair_id'),
      is_active: knex.raw('excluded.is_active'),
      updated_at: knex.fn.now(),
    });
}
