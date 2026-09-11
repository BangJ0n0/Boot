const axios = require("axios");
const fs = require("fs");
const path = require("path");
const QRCode = require("qrcode");
const crypto = require("crypto");

/**
 * Random Order ID
 */
function randomOrderId() {
  return "ORDER-" + crypto.randomBytes(5).toString("hex").toUpperCase();
}

/**
 * Convert rupiah helper
 */
function toRupiah(num) {
  return String(num).replace(/[^0-9]/g, "");
}

/**
 * ============================
 * CREATE PAYMENT
 * ============================
 */
async function createPayment(type, amount, config) {


if (type === "pakasir") {
  const { slug, apiKey } = config.pakasir;
  const orderId = randomOrderId();

  const url = "https://app.pakasir.com/api/transactioncreate/qris";
  const body = {
    project: slug,
    order_id: orderId,
    amount,
    api_key: apiKey
  };

  const res = await axios.post(url, body, {
    headers: { "Content-Type": "application/json" }
  });

  const payment = res.data?.payment;
  if (!payment?.payment_number)
    throw new Error("QR Pakasir tidak ditemukan");

  const qrString = payment.payment_number;

  const qrApiUrl = "https://api.qrserver.com/v1/create-qr-code/";
  const params = new URLSearchParams({
    size: "400x400",
    margin: "25",
    data: qrString
  });

  const qrImageUrl = `${qrApiUrl}?${params.toString()}`;

  return {
    type,
    amount,
    orderId,
    qris: qrImageUrl, // sekarang berupa URL gambar
    expiredAt: payment.expired_at
  };
}

  throw new Error("Type payment tidak dikenal");
}

/**
 * ============================
 * CHECK PAYMENT STATUS
 * ============================
 */
async function cekPaid(type, data, config) {

  // ===== ORDERKUOTA VIA SKY API =====
  if (type === "orderkuota") {
    const { username, token, apikey } = config.orderkuota;

    const url = "https://lyyncode.web.id/";

    const params = {
      action: "mutasiqr",
      apikey,
      username,
      token
    };

    const res = await axios.get(url, { params });

    if (!res.data?.status || !res.data?.result?.results) {
      return false;
    }

    const list = res.data.result.results;

    // cari transaksi masuk (IN) sesuai nominal
    const found = list.find(trx =>
      trx.status === "IN" &&
      toRupiah(trx.kredit) === toRupiah(data.amount)
    );

    return Boolean(found);
  }

  // ===== PAKASIR =====
  if (type === "pakasir") {
    const { slug, apiKey } = config.pakasir;

    const cekUrl = "https://app.pakasir.com/api/transactiondetail";

    const params = {
      project: slug,
      order_id: data.orderId,
      amount: data.amount,
      api_key: apiKey
    };

    const res = await axios.get(cekUrl, { params });

    const status =
      res.data?.transaction?.status ||
      res.data?.payment?.status ||
      res.data?.status ||
      "";

    return ["paid", "success", "completed"].includes(
      String(status).toLowerCase()
    );
  }

  throw new Error("Type payment tidak dikenal");
}

module.exports = {
  createPayment,
  cekPaid
};