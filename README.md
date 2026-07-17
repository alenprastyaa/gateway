# tiktok-landing-gateway

Central landing page + iPaymu payment gateway + routing CMS. This is the only
service that talks to iPaymu — it whitelists one fixed IP forever, and
provisions paid users onto whichever backend `tiktok-bisnis` VPS is currently
"active" (with quota-based failover to the next VPS).

## Setup

```
npm install
cp .env.example .env   # fill in DB_*, IPAYMU_*, PUBLIC_BASE_URL, JWT_SECRET, SECRET_ENCRYPTION_KEY
# generate SECRET_ENCRYPTION_KEY with:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# create the landing_gateway database on the MySQL server first, e.g.:
mysql -u root -p -e "CREATE DATABASE landing_gateway"

npm run migrate
node src/scripts/createAdmin.js <username> <password> [email]
npm run dev
```

Admin CMS: `http://localhost:<PORT>/admin/`
Landing page: `http://localhost:<PORT>/`

## Backend VPS setup (per each `tiktok-bisnis` instance)

Add to that VPS's `.env-builder`:
```
INTERNAL_PROVISION_SECRET=<generate with the same command as above, unique per VPS>
```
Restart the app, then register that VPS in this CMS (`Target VPS` section) using its
public `base_url` and the same `INTERNAL_PROVISION_SECRET` as `internal_secret`.
A VPS can only be set "active" once every active package plan has a
package-mapping to it (`PUT /api/admin/packages/:id/mappings/:targetVpsId`).

## Notes

- `internal_secret` is encrypted at rest (AES-256-GCM) and never returned by any API response.
- iPaymu webhook idempotency is keyed on the order's `status` transition (paid once, stays paid).
- If a paid order's provisioning call to the backend VPS fails, the order stays `status: paid`
  with `provisioning_status: failed` — money is never lost, retry from the admin CMS.
# gateway
