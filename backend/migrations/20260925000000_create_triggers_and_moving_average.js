/**
 * Migration: Create update_timestamp and moving_average triggers
 *
 * Implements:
 * 1. update_timestamp trigger function for automatic updated_at timestamp updates on row modifications.
 * 2. calculate_moving_average trigger function on trade inserts.
 *
 * @param {import('knex').Knex} knex
 */
export async function up(knex) {
  // 1. Create trades table if not exists
  const hasTradesTable = await knex.schema.hasTable('trades');
  if (!hasTradesTable) {
    await knex.schema.createTable('trades', (table) => {
      table.increments('id').primary();
      table.string('contract_id').notNullable().index();
      table.decimal('price', 20, 8).notNullable();
      table.decimal('volume', 20, 2).defaultTo(1);
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.timestamp('updated_at').defaultTo(knex.fn.now());
    });
  }

  // 2. Create asset_moving_averages table if not exists
  const hasMovingAvgTable = await knex.schema.hasTable('asset_moving_averages');
  if (!hasMovingAvgTable) {
    await knex.schema.createTable('asset_moving_averages', (table) => {
      table.string('contract_id').primary();
      table.decimal('moving_avg_price', 20, 8).notNullable();
      table.integer('sample_size').defaultTo(5);
      table.timestamp('updated_at').defaultTo(knex.fn.now());
    });
  }

  // PostgreSQL-specific trigger functions
  if (knex.client.config.client === 'pg' || knex.client.config.client === 'postgresql') {
    // 3. update_timestamp trigger function
    await knex.raw(`
      CREATE OR REPLACE FUNCTION update_timestamp()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = CURRENT_TIMESTAMP;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    // Attach trigger to trades table
    await knex.raw(`
      DROP TRIGGER IF EXISTS trg_update_timestamp_trades ON trades;
      CREATE TRIGGER trg_update_timestamp_trades
      BEFORE UPDATE ON trades
      FOR EACH ROW
      EXECUTE FUNCTION update_timestamp();
    `);

    // Attach trigger to assets table if it exists
    const hasAssets = await knex.schema.hasTable('assets');
    if (hasAssets) {
      await knex.raw(`
        DROP TRIGGER IF EXISTS trg_update_timestamp_assets ON assets;
        CREATE TRIGGER trg_update_timestamp_assets
        BEFORE UPDATE ON assets
        FOR EACH ROW
        EXECUTE FUNCTION update_timestamp();
      `);
    }

    // 4. Moving average calculation trigger function for trade inserts
    await knex.raw(`
      CREATE OR REPLACE FUNCTION calculate_moving_average()
      RETURNS TRIGGER AS $$
      DECLARE
        v_avg_price DECIMAL(20, 8);
        v_sample_size INT := 5;
      BEGIN
        SELECT AVG(price) INTO v_avg_price
        FROM (
          SELECT price
          FROM trades
          WHERE contract_id = NEW.contract_id
          ORDER BY created_at DESC, id DESC
          LIMIT v_sample_size
        ) recent_trades;

        INSERT INTO asset_moving_averages (contract_id, moving_avg_price, sample_size, updated_at)
        VALUES (NEW.contract_id, v_avg_price, v_sample_size, CURRENT_TIMESTAMP)
        ON CONFLICT (contract_id)
        DO UPDATE SET
          moving_avg_price = EXCLUDED.moving_avg_price,
          sample_size = EXCLUDED.sample_size,
          updated_at = CURRENT_TIMESTAMP;

        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    await knex.raw(`
      DROP TRIGGER IF EXISTS trg_calculate_moving_average ON trades;
      CREATE TRIGGER trg_calculate_moving_average
      AFTER INSERT ON trades
      FOR EACH ROW
      EXECUTE FUNCTION calculate_moving_average();
    `);
  }
}

/**
 * @param {import('knex').Knex} knex
 */
export async function down(knex) {
  if (knex.client.config.client === 'pg' || knex.client.config.client === 'postgresql') {
    await knex.raw('DROP TRIGGER IF EXISTS trg_calculate_moving_average ON trades');
    await knex.raw('DROP FUNCTION IF EXISTS calculate_moving_average()');
    await knex.raw('DROP TRIGGER IF EXISTS trg_update_timestamp_trades ON trades');
    await knex.raw('DROP TRIGGER IF EXISTS trg_update_timestamp_assets ON assets');
    await knex.raw('DROP FUNCTION IF EXISTS update_timestamp()');
  }

  await knex.schema.dropTableIfExists('asset_moving_averages');
  await knex.schema.dropTableIfExists('trades');
}
