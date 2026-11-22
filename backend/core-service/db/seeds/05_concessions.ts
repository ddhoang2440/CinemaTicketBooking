import type { Knex } from 'knex';

const concessions = [
  { id: '90000000-0000-4000-8000-000000000001', name: 'Bắp rang bơ (vừa)', unit_price_vnd: 45000 },
  { id: '90000000-0000-4000-8000-000000000002', name: 'Bắp rang bơ (lớn)', unit_price_vnd: 59000 },
  { id: '90000000-0000-4000-8000-000000000003', name: 'Coca-Cola (vừa)', unit_price_vnd: 32000 },
  { id: '90000000-0000-4000-8000-000000000004', name: 'Nước suối Aquafina', unit_price_vnd: 20000 },
  { id: '90000000-0000-4000-8000-000000000005', name: 'Combo Bắp + Nước', unit_price_vnd: 79000 },
];

// Idempotent: fixed ids, upsert. Never deletes (booking_concessions may reference these rows).
export async function seed(knex: Knex): Promise<void> {
  await knex('concessions')
    .insert(concessions.map((c) => ({ ...c, is_available: true })))
    .onConflict('id')
    .merge({
      name: knex.raw('excluded.name'),
      unit_price_vnd: knex.raw('excluded.unit_price_vnd'),
      is_available: knex.raw('excluded.is_available'),
      updated_at: knex.fn.now(),
    });
}
