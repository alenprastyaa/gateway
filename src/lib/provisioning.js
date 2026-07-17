const axios = require("axios");
const { decryptSecret } = require("./crypto");
const { recordProvisionedUser } = require("./quota");
const { TargetVps } = require("../models");

function endpointUrl(targetVps, path) {
  return `${String(targetVps.base_url).replace(/\/+$/, "")}${path}`;
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
    return response.data;
  }

  throw new Error(
    response.data?.message || `Provisioning gagal dengan status ${response.status} dari ${targetVps.name}.`
  );
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
    const result = await provisionPaidUser(targetVps, {
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

    if (!result.already_existed) {
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

module.exports = { provisionPaidUser, fetchRemoteUserCount, runOrderProvisioning };
