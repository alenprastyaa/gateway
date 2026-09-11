const axios = require("axios");
const { decryptSecret } = require("./crypto");
const { recordProvisionedUser } = require("./quota");
const { hashPassword } = require("./auth");
const { TargetVps, Customer } = require("../models");

// 2026-08-17 (user-identity slice): mirrors the SAME plaintext password the
// backend VPS generated for this account (provision-paid-user/renew-paid-user
// now both return it in their response `password` field) into this gateway's
// own `customers` table, hashed. Best-effort on purpose — the money is
// already collected and the account already exists on the backend VPS by
// the time this runs, so a failure here must never unwind or fail the
// caller; it only means this gateway's own login-verification copy is
// temporarily stale, which self-heals on the next provision/renew call for
// the same account (see the `already_existed`/renewal branches in
// internal.routes.js on the backend VPS, which resend the same password on
// every call for exactly this reason).
async function upsertCustomerCredential(targetVps, { email, username, password }) {
  if (!username || !password) return;
  try {
    const password_hash = await hashPassword(password);
    const existing = await Customer.findOne({
      where: { target_vps_id: targetVps.id, username },
    });
    if (existing) {
      existing.email = email || existing.email;
      existing.password_hash = password_hash;
      await existing.save();
    } else {
      await Customer.create({
        target_vps_id: targetVps.id,
        email: email || "",
        username,
        password_hash,
      });
    }
  } catch (e) {
    console.error("[provisioning] gagal menyimpan credential customer:", e.message);
  }
}

// tiktok-bisnis namespaces its own API under /iniq/api/... (app.js's
// ROOT_APP_PATH) to avoid clashing with hosted child-project routes at the
// same /api path — a bare /api/internal/... request 404s there.
function endpointUrl(targetVps, path) {
  return `${String(targetVps.base_url).replace(/\/+$/, "")}/iniq${path}`;
}

async function provisionPaidUser(
  targetVps,
  { referenceId, buyer, remotePackageId, amount, landingOrderId, referralCode }
) {
  const secret = decryptSecret(targetVps.internal_secret_encrypted);

  const response = await axios.post(
    endpointUrl(targetVps, "/api/internal/provision-paid-user"),
    {
      reference_id: referenceId,
      buyer,
      remote_package_id: remotePackageId,
      amount,
      landing_order_id: landingOrderId,
      // Affiliate (2026-09-11). The code the buyer arrived with, carried from
      // the checkout page through the order row to the backend VPS, which owns
      // the referral graph and decides whether it earns anything. This side
      // never validates or prices it — it only forwards what was captured,
      // alongside `amount`, which stays the gateway's authoritative figure.
      referral_code: referralCode || null,
    },
    {
      headers: { "X-Internal-Secret": secret },
      timeout: 15000,
      validateStatus: () => true,
    }
  );

  if (response.status >= 200 && response.status < 300 && response.data?.success) {
    await upsertCustomerCredential(targetVps, {
      email: response.data.user?.email || buyer.email,
      username: response.data.user?.username,
      password: response.data.password,
    });
    return response.data;
  }

  throw new Error(
    response.data?.message || `Provisioning gagal dengan status ${response.status} dari ${targetVps.name}.`
  );
}

async function renewPaidUser(targetVps, { referenceId, buyer, remotePackageId }) {
  const secret = decryptSecret(targetVps.internal_secret_encrypted);

  const response = await axios.post(
    endpointUrl(targetVps, "/api/internal/renew-paid-user"),
    {
      reference_id: referenceId,
      buyer: { email: buyer.email },
      remote_package_id: remotePackageId,
    },
    {
      headers: { "X-Internal-Secret": secret },
      timeout: 15000,
      validateStatus: () => true,
    }
  );

  if (response.status >= 200 && response.status < 300 && response.data?.success) {
    await upsertCustomerCredential(targetVps, {
      email: response.data.user?.email || buyer.email,
      username: response.data.user?.username,
      password: response.data.password,
    });
    return response.data;
  }

  /* The HTTP status rides along on the error because the caller has to tell
   * ONE failure apart from every other: 404 means the backend VPS has no
   * account for this email, which is recoverable by registering instead.
   * Matching on the message text would work today and break the first time
   * anyone rewords it. */
  const error = new Error(
    response.data?.message || `Renewal gagal dengan status ${response.status} dari ${targetVps.name}.`
  );
  error.status = response.status;
  throw error;
}

async function creditTokens(targetVps, { referenceId, userId, tokenAmount }) {
  const secret = decryptSecret(targetVps.internal_secret_encrypted);

  const response = await axios.post(
    endpointUrl(targetVps, "/api/internal/credit-tokens"),
    {
      reference_id: referenceId,
      user_id: userId,
      token_amount: tokenAmount,
    },
    {
      headers: { "X-Internal-Secret": secret },
      timeout: 15000,
      validateStatus: () => true,
    }
  );

  if (response.status >= 200 && response.status < 300 && response.data?.success) {
    return response.data;
  }

  throw new Error(
    response.data?.message || `Kredit token gagal dengan status ${response.status} dari ${targetVps.name}.`
  );
}

// Same shape as runOrderProvisioning, but for token top-up orders: no quota
// bookkeeping (crediting an existing user's balance never consumes a "new
// account" slot), and idempotent for the same reason — the backend VPS's
// credit-tokens endpoint just adds tokenAmount, so a retry after a genuine
// partial failure is safe, but we still gate on credit_status to avoid
// double-crediting on webhook retries once a credit has already succeeded.
async function runTokenOrderCrediting(order) {
  if (order.credit_status === "succeeded") {
    return { alreadyDone: true, success: true };
  }

  if (!order.target_vps_id) {
    order.credit_status = "failed";
    order.credit_last_error = "Order ini tidak memiliki target VPS.";
    await order.save();
    return { alreadyDone: false, success: false };
  }

  order.credit_status = "pending";
  order.credit_attempts += 1;
  await order.save();

  const targetVps = await TargetVps.findByPk(order.target_vps_id);
  if (!targetVps) {
    order.credit_status = "failed";
    order.credit_last_error = "Target VPS pada order ini tidak ditemukan lagi.";
    await order.save();
    return { alreadyDone: false, success: false };
  }

  try {
    await creditTokens(targetVps, {
      referenceId: order.reference_id,
      userId: order.remote_user_id,
      tokenAmount: order.token_amount,
    });

    order.credit_status = "succeeded";
    order.credited_at = new Date();
    order.credit_last_error = null;
    await order.save();

    return { alreadyDone: false, success: true };
  } catch (e) {
    order.credit_status = "failed";
    order.credit_last_error = e.message || "Kredit token gagal.";
    await order.save();
    return { alreadyDone: false, success: false, error: e.message };
  }
}

async function fetchRemoteUserCount(targetVps) {
  const secret = decryptSecret(targetVps.internal_secret_encrypted);

  const response = await axios.get(endpointUrl(targetVps, "/api/internal/user-count"), {
    headers: { "X-Internal-Secret": secret },
    timeout: 10000,
    validateStatus: () => true,
  });

  if (response.status !== 200 || typeof response.data?.count !== "number") {
    throw new Error(`Gagal mengambil user-count dari ${targetVps.name}.`);
  }

  return response.data.count;
}

// Orchestrates a full provisioning attempt for one order: calls the backend VPS,
// updates the order's provisioning fields, and advances quota on genuinely new
// creations. Shared by the notify webhook and the admin "retry" endpoint —
// idempotent thanks to the backend's email pre-check (already_existed:true skips
// the quota increment).
async function runOrderProvisioning(order) {
  if (order.provisioning_status === "succeeded") {
    return { alreadyDone: true, success: true };
  }

  if (!order.target_vps_id) {
    order.provisioning_status = "failed";
    order.provisioning_last_error = "Order ini tidak memiliki target VPS.";
    await order.save();
    return { alreadyDone: false, success: false };
  }

  order.provisioning_status = "pending";
  order.provisioning_attempts += 1;
  await order.save();

  const targetVps = await TargetVps.findByPk(order.target_vps_id);
  if (!targetVps) {
    order.provisioning_status = "failed";
    order.provisioning_last_error = "Target VPS pada order ini tidak ditemukan lagi.";
    await order.save();
    return { alreadyDone: false, success: false };
  }

  try {
    /* `let`, because a renewal can turn out to be a registration (2026-09-05).
     *
     * order_type is decided at CHECKOUT from this gateway's own history: any
     * email with a previously succeeded order is treated as a renewal forever
     * after. That reads the wrong source. Whether an account exists is a fact
     * about the BACKEND VPS, and an account can be deleted there without
     * anything here changing — after which every future purchase by that
     * customer was routed to the renewal endpoint, refused because there is
     * no account to renew, and left as `paid` + `failed`.
     *
     * The customer had already been charged by then. Found in production with
     * three such orders from one buyer across seven weeks: paid three times,
     * received nothing, no email, no visible trace.
     *
     * So a renewal that the VPS answers with 404 is retried as a
     * registration. That also covers the case checkout-time verification
     * could not: an account deleted BETWEEN checkout and provisioning.
     */
    let isRenewal = order.order_type === "renewal";
    let result;

    if (isRenewal) {
      try {
        result = await renewPaidUser(targetVps, {
          referenceId: order.reference_id,
          buyer: { email: order.buyer_email },
          remotePackageId: order.remote_package_id,
        });
      } catch (renewError) {
        if (renewError.status !== 404) throw renewError;

        console.warn(
          `[provisioning] order ${order.reference_id}: ${targetVps.name} tidak punya akun ` +
            `untuk ${order.buyer_email} — diperlakukan sebagai pendaftaran baru.`
        );
        /* Corrected on the row too, so the ledger says what actually
         * happened and the quota bookkeeping below counts it as a creation. */
        isRenewal = false;
        order.order_type = "new_registration";
        result = await provisionPaidUser(targetVps, {
          referenceId: order.reference_id,
          buyer: { name: order.buyer_name, email: order.buyer_email, phone: order.buyer_phone },
          remotePackageId: order.remote_package_id,
          amount: order.amount,
          landingOrderId: order.id,
          // Must be forwarded on THIS path too: an order that looked like a
          // renewal but found no account is reclassified as a registration
          // right above, and that is exactly the case a referral belongs to.
          // Omitting it here would silently drop the commission for every
          // buyer who reached us through this fallback.
          referralCode: order.referral_code,
        });
      }
    } else {
      result = await provisionPaidUser(targetVps, {
        referenceId: order.reference_id,
        buyer: { name: order.buyer_name, email: order.buyer_email, phone: order.buyer_phone },
        remotePackageId: order.remote_package_id,
        amount: order.amount,
        landingOrderId: order.id,
        referralCode: order.referral_code,
      });
    }

    order.provisioning_status = "succeeded";
    order.remote_user_id = result.user?.id || null;
    order.remote_username = result.user?.username || null;
    order.provisioned_at = new Date();
    order.provisioning_last_error = null;
    await order.save();

    // Renewals extend an existing account on a VPS it already occupies a slot
    // on — never advance quota for them, only for genuinely new creations.
    if (!isRenewal && !result.already_existed) {
      await recordProvisionedUser(targetVps.id);
    }

    return { alreadyDone: false, success: true };
  } catch (e) {
    order.provisioning_status = "failed";
    order.provisioning_last_error = e.message || "Provisioning gagal.";
    await order.save();
    return { alreadyDone: false, success: false, error: e.message };
  }
}

async function extendProduction(targetVps, { referenceId, userId, projectIds }) {
  const secret = decryptSecret(targetVps.internal_secret_encrypted);

  const response = await axios.post(
    endpointUrl(targetVps, "/api/internal/extend-production"),
    {
      reference_id: referenceId,
      user_id: userId,
      project_ids: projectIds,
    },
    {
      headers: { "X-Internal-Secret": secret },
      // Longer than creditTokens' 15s: this writes one row per project rather
      // than incrementing a single balance, so the work scales with the size
      // of the order.
      timeout: 30000,
      validateStatus: () => true,
    }
  );

  if (response.status >= 200 && response.status < 300 && response.data?.success) {
    return response.data;
  }

  throw new Error(
    response.data?.message ||
      `Perpanjangan produksi gagal dengan status ${response.status} dari ${targetVps.name}.`
  );
}

// Same shape as runTokenOrderCrediting, for production-year renewals.
//
// Two independent idempotency gates stand between a retried webhook and a
// free year, and both are needed:
//   here          extend_status === "succeeded" short-circuits, so a retry
//                   after a completed extension never calls the VPS again.
//   backend VPS   records reference_id per project, so even a call that DOES
//                   arrive twice (a retry after a partial failure, where this
//                   gate is deliberately open) extends each project once.
// Money is involved and webhooks are retried by design, so neither gate is
// redundant with the other — this one is an optimisation, the backend's is
// the guarantee.
async function runProductionOrderCrediting(order) {
  if (order.extend_status === "succeeded") {
    return { alreadyDone: true, success: true };
  }

  if (!order.target_vps_id) {
    order.extend_status = "failed";
    order.extend_last_error = "Order ini tidak memiliki target VPS.";
    await order.save();
    return { alreadyDone: false, success: false };
  }

  order.extend_status = "pending";
  order.extend_attempts += 1;
  await order.save();

  const targetVps = await TargetVps.findByPk(order.target_vps_id);
  if (!targetVps) {
    order.extend_status = "failed";
    order.extend_last_error = "Target VPS pada order ini tidak ditemukan lagi.";
    await order.save();
    return { alreadyDone: false, success: false };
  }

  try {
    await extendProduction(targetVps, {
      referenceId: order.reference_id,
      userId: order.remote_user_id,
      projectIds: Array.isArray(order.remote_project_ids)
        ? order.remote_project_ids
        : [],
    });

    order.extend_status = "succeeded";
    order.extended_at = new Date();
    order.extend_last_error = null;
    await order.save();

    return { alreadyDone: false, success: true };
  } catch (e) {
    order.extend_status = "failed";
    order.extend_last_error = e.message || "Perpanjangan produksi gagal.";
    await order.save();
    return { alreadyDone: false, success: false, error: e.message };
  }
}

module.exports = {
  provisionPaidUser,
  renewPaidUser,
  fetchRemoteUserCount,
  runOrderProvisioning,
  creditTokens,
  runTokenOrderCrediting,
  upsertCustomerCredential,
  extendProduction,
  runProductionOrderCrediting,
};
