# Database Migrations

The backend uses **[Knex.js](https://knexjs.org/)** as the migration tool.  
Migration state is tracked automatically in a `knex_migrations` table created by Knex on first run.

## Configuration

| Environment | Client | Connection |
|-------------|--------|------------|
| `development` | SQLite (`better-sqlite3`) | `./dev.db` or `DATABASE_URL` env var |
| `test` | SQLite in-memory | `:memory:` |
| `production` | PostgreSQL (`pg`) | `DATABASE_URL` env var (required) |

Set `DATABASE_URL` in your `.env` file:

```env
# SQLite (dev)
DATABASE_URL=./dev.db

# PostgreSQL (production)
DATABASE_URL=postgresql://user:password@host:5432/dbname
```

## Running migrations

```bash
# Apply all pending migrations
npm run migrate

# Roll back the most recent migration batch
npm run migrate:rollback

# Show applied / pending migration status
npm run migrate:status
```

## Creating a new migration

```bash
npm run migrate:make -- <migration_name>
# Example:
npm run migrate:make -- add_location_to_assets
```

This generates a timestamped file in `backend/migrations/`.  
Edit the generated file and implement `up` (apply) and `down` (rollback):

```js
export async function up(knex) {
  await knex.schema.table('assets', (table) => {
    table.string('location');
  });
}

export async function down(knex) {
  await knex.schema.table('assets', (table) => {
    table.dropColumn('location');
  });
}
```

## Migration files

| File | Description |
|------|-------------|
| `20260628000000_create_assets_table.js` | Creates the `assets` table with core columns |

## How it works

1. On first run, Knex creates a `knex_migrations` table to record which migrations have been applied and in which batch.
2. `npm run migrate` runs all migrations that are not yet recorded in that table.
3. `npm run migrate:rollback` reverts the last batch of migrations by calling their `down` functions.
4. Each migration file exports an `up` and a `down` function — always implement both to support rollbacks.

> **Tip for contributors:** every PR that changes the database schema must include a new migration file. Never edit an existing migration that has already been applied in production.
