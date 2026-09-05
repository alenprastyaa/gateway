const express = require("express");
const crypto = require("crypto");
const rateLimit = require("express-rate-limit");
const {
  PackagePlan,
  TargetVps,
  PackageMapping,
  PaymentOrder,
  TokenOrder,
  ProductionOrder,
} = require("../models");
const { createIpaymuRedirectPayment, verifyIpaymuCallbackSignature } = require("../lib/ipaymu");
const { pickActiveTarget } = require("../lib/quota");
const {
  runOrderProvisioning,
  runTokenOrderCrediting,
  runProductionOrderCrediting,
} = require("../lib/provisioning");

const router = express.Router();

const checkoutLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
});

function generateReferenceId() {
  return `PKG-${Date.now().toString(36).toUpperCase()}-${crypto
    .randomBytes(3)
    .toString("hex")
    .toUpperCase()}`;
}

router.post("/ipaymu/checkout", checkoutLimiter, async (req, res, next) => {
  try {
    const packageId = Number.parseInt(req.body?.package_id, 10);
    const buyer = {
      name: String(req.body?.buyer_name || "").trim(),
      email: String(req.body?.buyer_email || "").trim(),
      phone: String(req.body?.buyer_phone || "").trim(),
    };

    if (!packageId) {
      return res.status(400).json({ message: "Paket wajib dipilih." });
    }
    if (!buyer.name || !buyer.email || !buyer.phone) {
      return res.status(400).json({ message: "Nama, email, dan nomor WhatsApp wajib diisi." });
    }

    const plan = await PackagePlan.findOne({ where: { id: packageId, is_active: true } });
    if (!plan) {
      return res.status(404).json({ message: "Paket tidak ditemukan atau sedang nonaktif." });
    }

    // If this email already has a successfully provisioned order, treat this
    // checkout as a renewal and route it to the same VPS the account actually
    // lives on — that VPS may no longer be the currently "active" quota target.
    const previousOrder = await PaymentOrder.findOne({
      where: { buyer_email: buyer.email.trim(), provisioning_status: "succeeded" },
      order: [["createdAt", "DESC"]],
    });
    const orderType = previousOrder ? "renewal" : "new_registration";

    const targetVps = previousOrder
      ? await TargetVps.findByPk(previousOrder.target_vps_id)
      : await pickActiveTarget();
    if (!targetVps) {
      return res.status(400).json({
        message: previousOrder
          ? "VPS asal akun Anda tidak ditemukan lagi. Hubungi admin."
          : "Tidak ada VPS target aktif saat ini. Hubungi admin.",
      });
    }

    const mapping = await PackageMapping.findOne({
      where: { package_plan_id: plan.id, target_vps_id: targetVps.id },
    });
    if (!mapping) {
      return res.status(400).json({
        message: "Paket ini belum dikonfigurasi untuk VPS aktif saat ini. Hubungi admin.",
      });
    }

    const referenceId = generateReferenceId();
    const amount = Number(plan.initial_price) || 0;

    const ipaymuResult = await createIpaymuRedirectPayment(req, {
      plan,
      order: { reference_id: referenceId, amount },
      buyer,
    });

    const order = await PaymentOrder.create({
      reference_id: referenceId,
      package_plan_id: plan.id,
      buyer_name: buyer.name,
      buyer_email: buyer.email,
      buyer_phone: buyer.phone,
      amount,
      status: "pending",
      order_type: orderType,
      ipaymu_session_id: ipaymuResult?.Data?.SessionID || null,
      ipaymu_payment_url: ipaymuResult?.Data?.Url || null,
      ipaymu_response: ipaymuResult,
      callback_payloads: [],
      target_vps_id: targetVps.id,
      remote_package_id: mapping.remote_package_id,
    });

    res.status(201).json({
      reference_id: order.reference_id,
      payment_url: order.ipaymu_payment_url,
    });
  } catch (e) {
    next(e);
  }
});

router.get("/status/:referenceId", async (req, res, next) => {
  try {
    const referenceId = String(req.params.referenceId || "");
    if (referenceId.startsWith("PRJ-")) {
      const order = await ProductionOrder.findOne({ where: { reference_id: referenceId } });
      if (!order) {
        return res.status(404).json({ message: "Order pembayaran tidak ditemukan." });
      }
      return res.json({
        reference_id: order.reference_id,
        status: order.status,
        provisioning_status: order.extend_status,
        provisioning_last_error: order.extend_last_error || null,
        project_count: order.project_count,
        amount: order.amount,
        updatedAt: order.updatedAt,
      });
    }

    if (referenceId.startsWith("TOK-")) {
      const order = await TokenOrder.findOne({ where: { reference_id: referenceId } });
      if (!order) {
        return res.status(404).json({ message: "Order pembayaran tidak ditemukan." });
      }
      return res.json({
        reference_id: order.reference_id,
        status: order.status,
        provisioning_status: order.credit_status,
        provisioning_last_error: order.credit_last_error || null,
        token_amount: order.token_amount,
        updatedAt: order.updatedAt,
      });
    }

    const order = await PaymentOrder.findOne({
      where: { reference_id: referenceId },
    });
    if (!order) {
      return res.status(404).json({ message: "Order pembayaran tidak ditemukan." });
    }
    res.json({
      reference_id: order.reference_id,
      status: order.status,
      provisioning_status: order.provisioning_status,
      remote_username: order.remote_username || null,
      provisioning_last_error: order.provisioning_last_error || null,
      updatedAt: order.updatedAt,
    });
  } catch (e) {
    next(e);
  }
});

router.post("/ipaymu/notify", async (req, res, next) => {
  try {
    const payload = req.body || {};

    // Reject anything that isn't genuinely signed by iPaymu — otherwise
    // anyone can POST { reference_id, status: "berhasil" } straight to this
    // endpoint and get an order marked paid (and provisioned) for free.
    if (!verifyIpaymuCallbackSignature(payload, req.headers["x-signature"])) {
      console.warn("[ipaymu:notify] rejected — invalid or missing X-Signature", {
        ip: req.ip,
        reference_id: payload.reference_id || payload.referenceId || null,
        trx_id: payload.trx_id || null,
      });
      return res.status(400).json({ success: false, message: "Invalid signature." });
    }

    const referenceId = String(
      payload.reference_id || payload.referenceId || payload.ReferenceId || payload.trx_id || ""
    ).trim();
    const statusText = String(
      payload.status || payload.Status || payload.statusDesc || payload.StatusDesc || payload.paidStatus || ""
    ).toLowerCase();

    if (!referenceId) {
      return res.status(400).json({ success: false, message: "reference_id tidak ditemukan." });
    }

    // Token top-up orders use a distinct reference prefix (TOK-) so this one
    // webhook URL — the only notifyUrl iPaymu is configured with — can route
    // to the right table and the right post-payment action.
    const isTokenOrder = referenceId.startsWith("TOK-");
    // PRJ- = production-app year renewal (2026-09-05), same routing trick.
    const isProductionOrder = referenceId.startsWith("PRJ-");
    const OrderModel = isTokenOrder
      ? TokenOrder
      : isProductionOrder
      ? ProductionOrder
      : PaymentOrder;

    const order = await OrderModel.findOne({ where: { reference_id: referenceId } });
    if (!order) {
      return res.status(404).json({ success: false, message: "Order pembayaran tidak ditemukan." });
    }

    // Idempotency: don't re-run provisioning/crediting on webhook retries
    // once we've already recorded this order as paid (iPaymu has no
    // request-id header like DOKU does, so we dedupe on the status transition).
    if (order.status === "paid") {
      order.callback_payloads = [
        ...(Array.isArray(order.callback_payloads) ? order.callback_payloads : []),
        { receivedAt: new Date().toISOString(), payload },
      ];
      await order.save();
      return res.json({ success: true, duplicate: true });
    }

    const paid =
      statusText.includes("berhasil") ||
      statusText.includes("paid") ||
      statusText === "1" ||
      statusText.includes("success");
    const expired = statusText.includes("expired") || statusText.includes("cancel");

    order.status = paid ? "paid" : expired ? "expired" : "pending";
    order.callback_payloads = [
      ...(Array.isArray(order.callback_payloads) ? order.callback_payloads : []),
      { receivedAt: new Date().toISOString(), payload },
    ];
    await order.save();

    // Ack iPaymu immediately, then provision/credit in the background — mirrors
    // the tiktok-bisnis DOKU notify handler's setImmediate pattern (app.js:8166),
    // so a slow/unreachable backend VPS never delays or fails the webhook ack.
    res.json({ success: true });

    if (paid) {
      setImmediate(async () => {
        try {
          if (isTokenOrder) {
            await runTokenOrderCrediting(order);
          } else if (isProductionOrder) {
            await runProductionOrderCrediting(order);
          } else {
            await runOrderProvisioning(order);
          }
        } catch (e) {
          console.error("Provisioning/crediting error for order", order.reference_id, e);
        }
      });
    }
  } catch (e) {
    next(e);
  }
});

module.exports = router;
