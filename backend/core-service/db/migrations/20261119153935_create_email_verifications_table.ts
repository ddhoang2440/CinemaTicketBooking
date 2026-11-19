import type { Knex } from "knex";


export async function up(knex: Knex): Promise<void> {
    await knex.schema.createTable('email_verifications', (table) => {
    table.increments('id').primary();
    
    // Bỏ unsigned
    table.integer('user_id').notNullable()
         .references('id').inTable('users').onDelete('CASCADE');
         
    // Đổi token -> token_hash
    table.string('token_hash', 255).notNullable().unique(); 
    
    table.timestamp('expires_at').notNullable();
    table.timestamp('created_at').defaultTo(knex.fn.now());
  });
}


export async function down(knex: Knex): Promise<void> {
    await knex.schema.dropTable('email_verifications');
}

