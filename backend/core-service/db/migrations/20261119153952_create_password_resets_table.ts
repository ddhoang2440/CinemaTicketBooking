import type { Knex } from "knex";


export async function up(knex: Knex): Promise<void> {
    await knex.schema.createTable('password_resets', (table) => {
    table.increments('id').primary();
    
    table.integer('user_id').notNullable()
         .references('id').inTable('users').onDelete('CASCADE');
         
    table.string('token_hash', 255).notNullable().unique();
    table.timestamp('expires_at').notNullable();
    table.boolean('is_used').defaultTo(false);
    table.timestamp('created_at').defaultTo(knex.fn.now());
  });
}


export async function down(knex: Knex): Promise<void> {
    await knex.schema.dropTable('password_resets');
}

