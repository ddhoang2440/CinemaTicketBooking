import type { Knex } from 'knex';

/**
 * ID-01 — Idempotent Role Seed Data: core.roles
 * Owner: TV1 (Nguyễn Gia Khánh)
 *
 * ERD §2.1: roles { id UUID PK, code ('customer' | 'staff' | 'manager' | 'admin') UNIQUE }
 */
export const ROLE_IDS = {
  customer: '00000000-0000-4000-8000-000000000001',
  staff: '00000000-0000-4000-8000-000000000002',
  manager: '00000000-0000-4000-8000-000000000003',
  admin: '00000000-0000-4000-8000-000000000004',
} as const;

const ROLES = [
  {
    id: ROLE_IDS.customer,
    code: 'customer',
    role_name: 'customer',
    description: 'Khách hàng đặt vé và bắp nước',
  },
  {
    id: ROLE_IDS.staff,
    code: 'staff',
    role_name: 'staff',
    description: 'Nhân viên rạp soát vé QR check-in',
  },
  {
    id: ROLE_IDS.manager,
    code: 'manager',
    role_name: 'manager',
    description: 'Quản lý rạp, phòng chiếu, suất chiếu và giá vé',
  },
  {
    id: ROLE_IDS.admin,
    code: 'admin',
    role_name: 'admin',
    description: 'Quản trị viên toàn hệ thống',
  },
] as const;

export async function seed(knex: Knex): Promise<void> {
  await knex
    .withSchema('core')
    .into('roles')
    .insert([...ROLES])
    .onConflict('code')
    .merge({
      role_name: knex.raw('excluded.role_name'),
      description: knex.raw('excluded.description'),
      updated_at: knex.fn.now(),
    });
}