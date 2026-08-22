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

async function provisionPaidUser(targetVps, { referenceId, buyer, remotePackageId, amount, landingOrderId }) {
  const secret = decryptSecret(targetVps.internal_secret_encrypted);

  const response = await axios.post(
    endpointUrl(targetVps, "/api/internal/provision-paid-user"),
    {
      reference_id: referenceId,
      buyer,
      remote_package_id: remotePackageId,
      amount,
      landing_order_id: landingOrderId,
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

  throw new Error(
    response.data?.message || `Renewal gagal dengan status ${response.status} dari ${targetVps.name}.`
  );
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
    const isRenewal = order.order_type === "renewal";
    const result = isRenewal
      ? await renewPaidUser(targetVps, {
          referenceId: order.reference_id,
          buyer: { email: order.buyer_email },
          remotePackageId: order.remote_package_id,
        })
      : await provisionPaidUser(targetVps, {
          referenceId: order.reference_id,
          buyer: { name: order.buyer_name, email: order.buyer_email, phone: order.buyer_phone },
          remotePackageId: order.remote_package_id,
          amount: order.amount,
          landingOrderId: order.id,
        });

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

module.exports = {
  provisionPaidUser,
  renewPaidUser,
  fetchRemoteUserCount,
  runOrderProvisioning,
  creditTokens,
  runTokenOrderCrediting,
  upsertCustomerCredential,
};
