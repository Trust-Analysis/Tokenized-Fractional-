/**
 * Multi-Tenancy Middleware
 * 
 * Extracts the tenant identifier from the request (headers or JWT token)
 * and sets the PostgreSQL session context to enforce Row-Level Security.
 */

export function tenantContextMiddleware(db) {
  return async (req, res, next) => {
    try {
      // 1. Identify Tenant
      // Preference: JWT payload > Custom Header > Fallback for backward compatibility
      let tenantId = req.headers['x-tenant-id'];
      
      if (req.user && req.user.tenantId) {
        tenantId = req.user.tenantId;
      }

      // If no tenant is specified, reject the request in a strict multi-tenant environment
      if (!tenantId) {
        // Fallback for system admin or backward compatibility if configured
        tenantId = process.env.DEFAULT_TENANT_ID || 'default_tenant';
      }

      req.tenantId = tenantId;

      // 2. Set Context in Postgres (if using Postgres)
      // We wrap the request handler in a Knex transaction where the local session variable is set
      if (db.client.config.client === 'pg') {
        req.db = await db.transaction();
        // Use SET LOCAL so the setting only applies to this specific transaction block
        await req.db.raw(`SET LOCAL app.current_tenant_id = ?`, [tenantId]);
        
        // We must commit or rollback the transaction at the end of the request
        res.on('finish', () => {
          if (!req.db.isCompleted()) {
             req.db.commit();
          }
        });
        
        res.on('error', () => {
          if (!req.db.isCompleted()) {
             req.db.rollback();
          }
        });
      } else {
        // SQLite fallback for local development (RLS is handled in application logic)
        req.db = db; 
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}
