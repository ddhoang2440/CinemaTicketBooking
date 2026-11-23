import type { Knex } from 'knex';

/**
 * BO-01 — Migration: payment.refunds
 * Owner: TV4 (Nguyễn Huy Hoàng)
 *
 * ERD: refunds { id UUID PK, payment_id FK, booking_id, amount_vnd, reason, status,
 *                idempotency_key, processed_at }
 * Constraints:
 *   - amount_vnd >= 0 (integer VND, D-18)
 *   - amount_vnd <= payment.amount_vnd and payment status must not be 'failed'
 *   - reason IN (customer_cancelled, hold_expired_compensation) (D-07, D-09)
 *   - status IN (pending, refunded, failed)
 *   - unique(idempotency_key); at most one non-failed refund per payment
 * Notes: booking_id is a logical reference to core.bookings (no cross-schema FK).
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.withSchema('payment').createTable('refunds', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('payment_id').notNullable();
    table.uuid('booking_id').notNullable();
    table.bigInteger('amount_vnd').notNullable();
    table.string('reason', 40).notNullable();
    table.string('status', 30).notNullable().defaultTo('pending');
    table.string('idempotency_key', 128).notNullable();
    table.timestamp('processed_at', { useTz: true }).nullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table
      .foreign('payment_id', 'fk_refunds_payment')
      .references('id')
      .inTable('payment.payments')
      .onDelete('RESTRICT');
    table.unique(['idempotency_key'], { indexName: 'uq_refund_idempotency' });
    table.index(['payment_id'], 'idx_refunds_payment_id');
    table.index(['booking_id'], 'idx_refunds_booking_id');
  });

  await knex.raw(`
    ALTER TABLE payment.refunds
      ADD CONSTRAINT chk_refunds_amount_nonnegative CHECK (amount_vnd >= 0),
      ADD CONSTRAINT chk_refunds_reason CHECK (reason IN ('customer_cancelled','hold_expired_compensation')),
      ADD CONSTRAINT chk_refunds_status CHECK (status IN ('pending','refunded','failed'))
  `);
  // A failed refund attempt may be retried, but a payment cannot be refunded twice.
  await knex.raw(`
    CREATE UNIQUE INDEX uq_refunds_payment_active ON payment.refunds (payment_id)
      WHERE status <> 'failed'
  `);

  // Enforce refund amount <= payment amount and payment state eligibility (cannot refund a failed payment)
  await knex.raw(`
    CREATE OR REPLACE FUNCTION payment.fn_check_refund_eligibility()
    RETURNS TRIGGER AS $$
    DECLARE
      pay_amount BIGINT;
      pay_status VARCHAR(30);
    BEGIN
      SELECT amount_vnd, status
        INTO pay_amount, pay_status
        FROM payment.payments
       WHERE id = NEW.payment_id;

      IF pay_status = 'failed' THEN
        RAISE EXCEPTION 'Cannot create refund for a failed payment (%)', NEW.payment_id
          USING ERRCODE = '23514',
                CONSTRAINT = 'chk_refunds_payment_status_eligible';
      END IF;

      IF pay_amount IS NOT NULL AND NEW.amount_vnd > pay_amount THEN
        RAISE EXCEPTION 'Refund amount (%) exceeds payment amount (%)', NEW.amount_vnd, pay_amount
          USING ERRCODE = '23514',
                CONSTRAINT = 'chk_refunds_amount_le_payment';
      END IF;

      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER trg_refunds_eligibility
      BEFORE INSERT OR UPDATE ON payment.refunds
      FOR EACH ROW
      EXECUTE FUNCTION payment.fn_check_refund_eligibility();
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.withSchema('payment').dropTableIfExists('refunds');
  await knex.raw('DROP FUNCTION IF EXISTS payment.fn_check_refund_eligibility() CASCADE');
}
