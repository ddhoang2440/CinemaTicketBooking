import type { Knex } from "knex";


export async function up(knex: Knex): Promise<void> {
    await knex.schema.createTable('users', (table) => {
    table.increments('id').primary(); // Postgres tự hiểu là SERIAL (không cần unsigned)
    table.string('email', 255).notNullable().unique();
    table.string('password_hash', 255).notNullable();
    table.string('full_name', 100).notNullable();
    table.string('phone', 20);
    
    // Đã bỏ .unsigned()
    table.integer('role_id').notNullable()
         .references('id').inTable('roles').onDelete('RESTRICT');
         
    // Lưu ý: Thống nhất với TV2 tên bảng là 'cinemas' hay 'cinema_groups'
    // Ở đây mình ví dụ dùng 'cinemas' và cột 'cinema_id'
    table.integer('cinema_id').nullable();
    //      .references('id').inTable('cinemas').onDelete('RESTRICT'); 
    
    table.boolean('is_email_verified').defaultTo(false);
    table.boolean('is_active').defaultTo(true);
    
    table.timestamps(true, true);
    table.index('email');
  });
}


export async function down(knex: Knex): Promise<void> {
    await knex.schema.dropTable('users');
}

