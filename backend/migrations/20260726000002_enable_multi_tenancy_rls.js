/**
 * Multi-Tenancy & Row-Level Security (RLS) Migration
 * 
 * Adds tenant_id to all core tables, establishes the tenants table for onboarding/billing,
 * and configures PostgreSQL RLS policies to guarantee strict data isolation.
 *
 * @param {import('knex').Knex} knex
 */
export async function up(knex) {
  // 1. Create the tenants table for onboarding and config
  await knex.schema.createTable('tenants', (table) => {
    table.string('id').primary(); // Unique tenant identifier
    table.string('name').notNullable();
    table.string('status').defaultTo('active');
    table.string('billing_plan').defaultTo('standard'); // standard, enterprise
    table.jsonb('config').defaultTo('{}'); // tenant-specific configs
    table.integer('max_api_requests_per_min').defaultTo(100);
    table.timestamps(true, true);
  });

  // 2. Add tenant_id to existing tables
  const tablesToAlter = ['assets', 'api_keys', 'transactions', 'time_window_events'];
  
  for (const tableName of tablesToAlter) {
    await knex.schema.alterTable(tableName, (table) => {
      // Allow nullable initially for backward compatibility with existing data, 
      // but in a real production migration, we would backfill this.
      table.string('tenant_id').references('id').inTable('tenants').onDelete('CASCADE');
      table.index(['tenant_id']);
    });
  }

  // 3. Enable Postgres Row-Level Security (RLS)
  // Note: RLS is a PostgreSQL feature. If running SQLite in dev, we skip the raw RLS execution.
  if (knex.client.config.client === 'pg') {
    for (const tableName of tablesToAlter) {
      // Enable RLS on the table
      await knex.raw(`ALTER TABLE ${tableName} ENABLE ROW LEVEL SECURITY;`);
      
      // Create a policy that forces isolation based on a session variable 'app.current_tenant_id'
      await knex.raw(`
        CREATE POLICY tenant_isolation_policy ON ${tableName}
        USING (tenant_id = current_setting('app.current_tenant_id', TRUE));
      `);
      
      // We also create a bypass policy for system admins (when tenant_id is explicitly set to 'system_admin')
      await knex.raw(`
        CREATE POLICY admin_bypass_policy ON ${tableName}
        USING (current_setting('app.current_tenant_id', TRUE) = 'system_admin');
      `);
    }
  }
}

/**
 * @param {import('knex').Knex} knex
 */
export async function down(knex) {
  const tablesToAlter = ['assets', 'api_keys', 'transactions', 'time_window_events'];
  
  if (knex.client.config.client === 'pg') {
    for (const tableName of tablesToAlter) {
      await knex.raw(`DROP POLICY IF EXISTS tenant_isolation_policy ON ${tableName};`);
      await knex.raw(`DROP POLICY IF EXISTS admin_bypass_policy ON ${tableName};`);
      await knex.raw(`ALTER TABLE ${tableName} DISABLE ROW LEVEL SECURITY;`);
    }
  }

  for (const tableName of tablesToAlter) {
    await knex.schema.alterTable(tableName, (table) => {
      table.dropColumn('tenant_id');
    });
  }

  await knex.schema.dropTableIfExists('tenants');
}
